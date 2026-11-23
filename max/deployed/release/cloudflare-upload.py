"""Build a Cloudflare connector program. Default mode only checks the upload bundle."""

import argparse
import base64
import gzip
import hashlib
import json
import re
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Directory containing wrangler.json and the deployed modules")
    parser.add_argument("--commit", help="Git commit identifying the files, required with --upload")
    parser.add_argument("--upload", action="store_true", help="Generate a version upload, without changing traffic")
    args = parser.parse_args()
    if args.upload and not re.fullmatch("[0-9a-f]{40}", args.commit or ""):
        parser.error("--upload requires --commit followed by the exact Git SHA")
    config = json.loads((args.directory / "wrangler.json").read_text())
    modules = {p.name: p.read_bytes() for p in sorted(args.directory.glob("*.mjs"))}
    # The 1.6 MB PDF parser is already in the running Worker. Fetch its bytes in
    # the connector and check its SHA-256 against the checked-out Git copy.
    cached = "pdf-driver.mjs"
    packed = {k: v.decode("utf-8") for k, v in modules.items() if k != cached}
    packed = gzip.compress(json.dumps(packed, ensure_ascii=False).encode(), mtime=0)
    runtime = {
        "main_module": config["main"],
        "compatibility_date": config["compatibility_date"],
        "compatibility_flags": [],
        "usage_model": "standard",
        "bindings": [{"name": k["binding"], "type": "kv_namespace", "namespace_id": k["id"]}
                     for k in config["kv_namespaces"]] +
                    [{"name": d["binding"], "type": "d1", "database_id": d["database_id"]}
                     for d in config["d1_databases"]],
        "annotations": {"workers/message": "Max prospective research journal and fixed-unit simulation"},
    }
    if args.commit:
        runtime["annotations"]["workers/commit_sha"] = args.commit
    values = {"account": config["account_id"], "worker": config["name"], "runtime": runtime,
              "cached": cached, "digests": {k: hashlib.sha256(v).hexdigest() for k, v in modules.items()},
              "packed": base64.b64encode(packed).decode(), "upload": args.upload}
    print("async () => {\nconst input = " + json.dumps(values, separators=(",", ":")) + ";")
    print(r"""
if (accountId !== input.account) throw Error('Unexpected Cloudflare account');
const path = '/accounts/' + accountId + '/workers/scripts/' + input.worker;
const raw = await cloudflare.request({method: 'GET', path: path + '/content/v2'});
const boundary = raw.slice(0, raw.indexOf('\r\n'));
const prefix = 'name="' + input.cached + '"';
const part = raw.split(boundary).find(p => p.slice(0, p.indexOf('\r\n\r\n')).includes(prefix));
if (!part || !part.endsWith('\r\n')) throw Error('Existing PDF module missing');
const archive = Uint8Array.from(atob(input.packed), c => c.charCodeAt(0));
const contents = JSON.parse(await new Response(new Blob([archive]).stream()
  .pipeThrough(new DecompressionStream('gzip'))).text());
contents[input.cached] = part.slice(part.indexOf('\r\n\r\n') + 4, -2);
const form = new FormData();
form.append('metadata', new Blob([JSON.stringify(input.runtime)], {type:'application/json'}));
for (const [name, hash] of Object.entries(input.digests)) {
  const bytes = new TextEncoder().encode(contents[name]);
  const sum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    b => b.toString(16).padStart(2, '0')).join('');
  if (sum !== hash) throw Error('Source mismatch for ' + name);
  form.append(name, new Blob([bytes], {type:'application/javascript+module'}), name);
}
if (!input.upload) return {worker:input.worker, entrypoint:input.runtime.main_module,
  verified:Object.keys(input.digests).length, pdf_sha256:input.digests[input.cached],
  bindings:input.runtime.bindings.map(b=>b.name)};
const result = await cloudflare.request({method:'POST', path:path + '/versions', body:form});
return {version:result.result.id, number:result.result.number};
}""")


if __name__ == "__main__":
    main()

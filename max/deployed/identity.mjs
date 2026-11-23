/** Exact normalized token identity, scoped by caller to one team. No fuzzy name inference. */
export function playerIdentity(value){
 return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/)
  .filter(x=>x&&!['jr','sr','ii','iii','iv'].includes(x)).sort().join('|');
}

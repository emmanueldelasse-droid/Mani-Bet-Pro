/**
 * MANI BET PRO — provider.injuries.js
 *
 * Responsabilité unique : fournir les données de blessures NBA.
 * Source prioritaire : ESPN injuries (temps réel, 117+ joueurs).
 * Fallback : PDF NBA officiel (~2h avant matchs).
 *
 * Jamais de données vides mises en cache.
 */

import { API_CONFIG }    from '../config/api.config.js';
import { ProviderCache } from './provider.cache.js';
import { Logger }        from '../utils/utils.logger.js';

const WORKER = API_CONFIG.WORKER_BASE_URL;

export class ProviderInjuries {

  /**
   * Récupère le rapport de blessures du jour.
   * ESPN en priorité, PDF en fallback.
   * @param {string} date — YYYY-MM-DD
   * @returns {Promise<InjuryReport|null>}
   */
  static async getReport(date) {
    const cacheKey = ProviderCache.buildKey('nba', 'injuries', { date });
    const cached   = ProviderCache.get(cacheKey);
    if (cached) return cached;

    // Priorité 1 : ESPN injuries (temps réel)
    const espnReport = await this._fetchESPN();
    if (espnReport?.available && espnReport.players?.length > 0) {
      ProviderCache.set(cacheKey, espnReport, 'INJURIES');
      return espnReport;
    }

    // Fallback : PDF NBA officiel
    const pdfReport = await this._fetchPDF(date);
    if (pdfReport?.available) {
      ProviderCache.set(cacheKey, pdfReport, 'INJURIES');
      return pdfReport;
    }

    Logger.warn('INJURIES_UNAVAILABLE', { date });
    return null;
  }

  /**
   * Retourne les blessures d'une équipe depuis un rapport.
   * @param {InjuryReport} report
   * @param {string} teamName — nom complet (ex: "Miami Heat")
   * @returns {Array<InjuryPlayer>}
   */
  static getForTeam(report, teamName) {
    if (!report?.by_team || !teamName) return [];
    return report.by_team[teamName] ?? [];
  }

  // ── FETCHERS PRIVÉS ───────────────────────────────────────────────────

  static async _fetchESPN() {
    return this._fetch(
      `${WORKER}/nba/injuries/espn`,
      'ESPN_INJURIES',
      '/nba/injuries/espn'
    );
  }

  static async _fetchPDF(date) {
    return this._fetch(
      `${WORKER}${API_CONFIG.ROUTES.NBA.INJURIES}?date=${date}`,
      'NBA_PDF',
      '/nba/injuries',
      API_CONFIG.TIMEOUTS.INJURIES
    );
  }

  static async _fetch(url, provider, endpoint, timeout = API_CONFIG.TIMEOUTS.DEFAULT) {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal:  controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timer);

      Logger.apiCall({ provider, endpoint, statusCode: response.status, cached: false,
        error: response.ok ? null : `HTTP ${response.status}` });

      if (!response.ok) return null;
      return await response.json();

    } catch (err) {
      clearTimeout(timer);
      Logger.apiCall({ provider, endpoint, statusCode: 0, cached: false,
        error: err.name === 'AbortError' ? 'TIMEOUT' : err.message });
      return null;
    }
  }
}

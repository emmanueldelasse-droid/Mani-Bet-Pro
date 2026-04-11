/**
 * MANI BET PRO — ai.client.js v4
 *
 * Toutes les analyses Claude visibles sont désactivées côté front.
 * Le seul flux IA conservé dans l'application reste le flux blessures côté worker.
 */

import { Logger } from '../utils/utils.logger.js';

export class AIClient {
  static async explain(_analysisOutput, task = 'EXPLAIN', matchMeta = {}) {
    Logger.info('AI_CLIENT_DISABLED', { task, match: (matchMeta?.home || '?') + ' vs ' + (matchMeta?.away || '?') });
    return null;
  }
}

(function (root) {
  'use strict';
  const statuses = ['pending', 'reviewed', 'unfollowed', 'skipped', 'kept'];
  const PARSER_VERSION = 2;
  const reserved = new Set(['accounts', 'about', 'api', 'challenge', 'developer', 'direct', 'directory', 'emails', 'explore', 'legal', 'oauth', 'p', 'privacy', 'reel', 'reels', 'stories', 'terms', 'web', '_u']);

  // Keep this permissive for v1 review-history keys: migration must not erase decisions.
  function normalize(value) {
    if (typeof value !== 'string') return '';
    const name = value.replace(/^[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+|[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+$/g, '').replace(/^@/, '').toLowerCase();
    return /^[a-z0-9._]{1,30}$/.test(name) ? name : '';
  }
  function username(value) {
    const name = normalize(value);
    // A numeric field may be an ID. Fail closed instead of guessing a profile.
    return name && !/^\d+$/.test(name) && !name.startsWith('.') && !name.endsWith('.') && !name.includes('..') && !reserved.has(name) ? name : '';
  }
  function fromHref(href) {
    if (typeof href !== 'string') return '';
    try {
      const url = new URL(href.trim());
      if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.username || url.password || url.port) return '';
      const parts = url.pathname.split('/');
      if (parts.at(-1) === '') parts.pop();
      // Accept only /name and /_u/name, never posts, stories, IDs or extra segments.
      const raw = parts.length === 2 && parts[0] === '' ? parts[1] : parts.length === 3 && parts[0] === '' && parts[1] === '_u' ? parts[2] : '';
      const decoded = decodeURIComponent(raw);
      // Encoded punctuation that would change the path is not a username.
      return /^[a-z0-9._]+$/i.test(decoded) ? username(decoded) : '';
    } catch { return ''; }
  }
  function profile(value) {
    const name = username(value);
    if (!name || name !== value) throw Error('اسم المستخدم غير صالح. أعد استيراد بيانات حديثة.');
    return 'https://www.instagram.com/' + name + '/';
  }
  function matchesProfile(name, href) {
    try { return profile(name) === href; } catch { return false; }
  }
  function emptyStats() {
    return { files: 0, rows: 0, validRows: 0, unique: 0, duplicates: 0, missing: 0, invalid: 0, conflicts: 0, invalidLinks: 0, oldFiles: 0, countMismatch: 0 };
  }
  function extract(data, kind) {
    if (!['followers', 'following'].includes(kind)) throw Error('نوع ملف غير صالح.');
    const key = kind === 'following' ? 'relationships_following' : 'relationships_followers';
    const rows = Array.isArray(data) ? data : data && Object.hasOwn(data, key) ? data[key] : null;
    if (!Array.isArray(rows)) throw Error('صيغة الملف غير مدعومة. اختر ملف ' + kind + ' من تصدير Instagram بصيغة JSON.');
    const users = new Set(), stats = emptyStats();
    stats.files = 1;
    stats.rows = rows.length;
    for (const row of rows) {
      const entries = Array.isArray(row?.string_list_data) ? row.string_list_data : [];
      if (!entries.length) { stats.missing++; continue; }
      const candidates = new Set();
      let conflict = false, invalid = false, hasData = false;
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') { invalid = true; continue; }
        const hasValue = entry.value !== undefined && entry.value !== null && entry.value !== '';
        const hasHref = entry.href !== undefined && entry.href !== null && entry.href !== '';
        hasData ||= hasValue || hasHref;
        const value = hasValue ? username(entry.value) : '';
        const href = hasHref ? fromHref(entry.href) : '';
        if (hasHref && !href) { stats.invalidLinks++; invalid = true; }
        if (hasValue && !value) invalid = true;
        if (value && href && value !== href) conflict = true;
        if (value) candidates.add(value);
        if (href) candidates.add(href);
      }
      // title can be a display name. It is never identity evidence, even if ASCII.
      if (conflict || candidates.size > 1) { stats.conflicts++; continue; }
      if (invalid) { stats.invalid++; continue; }
      if (!hasData || !candidates.size) { stats.missing++; continue; }
      const name = [...candidates][0];
      stats.validRows++;
      if (users.has(name)) stats.duplicates++;
      users.add(name);
    }
    stats.unique = users.size;
    // Instagram JSON has no reliable total or export-generation date. Reconcile
    // row accounting and optional explicit counts, never relationship timestamps.
    if (stats.rows !== stats.validRows + stats.missing + stats.invalid + stats.conflicts || stats.unique !== stats.validRows - stats.duplicates) stats.countMismatch++;
    const declared = data && !Array.isArray(data) ? data.total_count ?? data.count : undefined;
    if (Number.isSafeInteger(declared) && declared >= 0 && declared !== stats.rows) stats.countMismatch++;
    return { users: [...users], ignored: stats.missing + stats.invalid + stats.conflicts, diagnostics: stats };
  }
  function initial() {
    return { version: 1, accounts: [], records: Object.create(null), current: null, counts: { followers: 0, following: 0 }, importedAt: null };
  }
  function merge(state, followers, following) {
    const followerSet = new Set(followers), accounts = [...new Set(following)].filter(name => !followerSet.has(name));
    return { ...state, accounts, counts: { followers: followerSet.size, following: new Set(following).size }, current: accounts.includes(state.current) ? state.current : accounts.find(name => !state.records[name] || state.records[name].status === 'pending') || accounts[0] || null, importedAt: new Date().toISOString() };
  }
  function validate(source) {
    if (!source || source.version !== 1 || !Array.isArray(source.accounts) || !source.records || typeof source.records !== 'object' || Array.isArray(source.records)) throw Error('نسخة احتياطية غير صالحة.');
    const out = initial();
    out.accounts = [...new Set(source.accounts.map(normalize).filter(Boolean))];
    for (const [name, record] of Object.entries(source.records)) {
      if (normalize(name) !== name || !record || !statuses.includes(record.status) || !(record.at === null || typeof record.at === 'string' && Number.isFinite(Date.parse(record.at)))) throw Error('سجل المراجعة غير صالح.');
      out.records[name] = { status: record.status, at: record.at };
    }
    out.current = out.accounts.includes(source.current) ? source.current : out.accounts[0] || null;
    if (source.counts && ['followers', 'following'].every(key => Number.isSafeInteger(source.counts[key]) && source.counts[key] >= 0)) out.counts = source.counts;
    out.importedAt = typeof source.importedAt === 'string' ? source.importedAt : null;
    if (source.importMeta?.parserVersion === PARSER_VERSION) {
      out.importMeta = { parserVersion: PARSER_VERSION };
      for (const kind of ['followers', 'following']) {
        const input = source.importMeta[kind];
        if (input && typeof input === 'object') {
          const stats = emptyStats();
          for (const key of Object.keys(stats)) if (Number.isSafeInteger(input[key]) && input[key] >= 0) stats[key] = input[key];
          out.importMeta[kind] = stats;
        }
      }
    }
    return out;
  }
  function nextPending(state, after = state.current) {
    const index = state.accounts.indexOf(after);
    return state.accounts.slice(index + 1).concat(state.accounts.slice(0, index + 1)).find(name => (state.records[name]?.status || 'pending') === 'pending') || null;
  }
  function diagnose(state, now = Date.now()) {
    const result = { parserVersion: state.importMeta?.parserVersion || 1, accounts: state.accounts.length, invalidNames: state.accounts.filter(name => !username(name)).length, duplicateAccounts: state.accounts.length - new Set(state.accounts).size, currentValid: !state.current || state.accounts.includes(state.current) && !!username(state.current), legacyImport: state.accounts.length > 0 && state.importMeta?.parserVersion !== PARSER_VERSION, oldImport: !!state.importedAt && now - Date.parse(state.importedAt) > 30 * 86400000, countsMismatch: false, followers: state.importMeta?.followers || null, following: state.importMeta?.following || null };
    result.countsMismatch = state.counts.following < state.accounts.length || ['followers', 'following'].some(kind => result[kind] && (result[kind].unique !== state.counts[kind] || result[kind].countMismatch > 0));
    return result;
  }
  const api = { normalize, username, fromHref, profile, matchesProfile, extract, initial, merge, validate, statuses, PARSER_VERSION, emptyStats, nextPending, diagnose };
  if (typeof module !== 'undefined') module.exports = api; else root.ReviewCore = api;
})(globalThis);

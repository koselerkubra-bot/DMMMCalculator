// Configuration is plain JSON in /config, versioned in Git. The same files are read by the
// browser (fetch) and by Node (fs) so both always use identical rules.
export const CONFIG_FILES = {
  model: 'model_2026.json',
  aliases: 'country_alias_master.json',
  metrics: 'global_metrics_2026.json',
  thresholds: 'threshold_config_2026.json',
};

export async function loadConfig(readJson) {
  const entries = await Promise.all(Object.entries(CONFIG_FILES).map(async ([k, f]) => [k, await readJson(f)]));
  return validateConfig(Object.fromEntries(entries));
}

export async function loadConfigBrowser(base = 'config/') {
  return loadConfig(async (f) => {
    const r = await fetch(base + f, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Could not load configuration ${f} (${r.status})`);
    return r.json();
  });
}

export function validateConfig(cfg) {
  const { model } = cfg;
  if (!model || !Array.isArray(model.capabilities) || model.capabilities.length !== 9) throw new Error('model config must define 9 capabilities');
  const rows = new Set();
  for (const s of model.skills) {
    if (rows.has(s.row)) throw new Error(`duplicate questionnaire row ${s.row} in model config`);
    rows.add(s.row);
  }
  for (const m of cfg.metrics.skills) {
    const sk = model.skills.find((s) => s.row === m.row);
    if (!sk || sk.owner !== 'gdm') throw new Error(`metrics mapping row ${m.row} is not a GDM-managed skill in the model`);
  }
  cfg.versions = {
    model: model.model_version,
    aliases: cfg.aliases.version,
    metrics: cfg.metrics.version,
    thresholds: cfg.thresholds.version,
  };
  return cfg;
}

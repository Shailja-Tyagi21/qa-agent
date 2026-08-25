const common = {
  require: ['steps/**/*.js', 'support/**/*.js'],
  format: [
    'progress-bar',
    'html:reports/cucumber-report.html',
    'json:reports/cucumber-report.json'
  ],
  formatOptions: { snippetInterface: 'async-await' },
  // One retry absorbs the occasional slow third-party widget on a live
  // production site. Two would start hiding real flakiness.
  retry: 1,
  timeout: 60000
}

module.exports = {
  // Hand-written suite only — this is the baseline the agent reports gaps against.
  default: { ...common, paths: ['features/*.feature'] },

  // Agent output only. @todo scenarios reference steps that don't exist yet.
  generated: { ...common, paths: ['features/generated/*.feature'], tags: 'not @todo' },

  // Everything, including @todo — expect undefined steps. Diagnostic use.
  all: { ...common, paths: ['features/**/*.feature'] }
}

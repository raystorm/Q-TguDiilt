/**
 * What the installer copies from the engine, as data. Every path is relative to the engine root and
 * uses `/`.
 */
export const manifest = {
   /** Folders copied whole, less the deny list. */
   roots: ['.workflow', '.amazonq/rules', 'docs/user'],

   /**
    * Single files copied: the docs the rules and prompts name, the overview pages, and the pages the
    * installed docs link to, directly or through one another.
    */
   files: [
      'docs/dev/commit-style-guide.md',
      'docs/dev/workflow/workflow-loops.md',
      'docs/dev/workflow/feature-tracking.md',
      'docs/overview.md',
      'docs/user-commands.md',
      'docs/FAQ.md',
      'docs/drift.md',
      'docs/extending.md',
      'docs/mindset.md',
      'docs/origin.md',
      'docs/profiles.md',
      'docs/dev/contract.md',
      'docs/dev/glossary.md',
      'docs/dev/governance.md',
      'docs/dev/workflow-patterns.md',
      'docs/dev/workflow/ai-workflow-system.md',
   ],

   /** Working Directories: only the structure markers directly in each are copied. */
   workingDirs: [
      '.amazonq/work',
      '.amazonq/work/current',
      '.amazonq/work/status',
      '.amazonq/suspended',
      '.workflow/work',
   ],
   markers: ['.gitignore', '.gitkeep', 'README.md'],

   /** The folder where a file must be a prompt or a helper prompt to be copied. */
   prompts: '.workflow/prompts',

   /** The marker file. The installer writes it, and it holds no entry for itself. */
   marker: '.workflow/installed.json',

   /** The service launcher. The registration in the IDE points at it. */
   launcher: '.workflow/acp/start.mjs',

   /**
    * The service's dependencies: `npm ci` runs in `folder` when the lockfile is written, or when `done`,
    * which npm leaves last, is missing.
    */
   install: {
      folder:   '.workflow/acp',
      lockfile: '.workflow/acp/package-lock.json',
      done:     '.workflow/acp/node_modules/.package-lock.json',
      command:  'npm',
      args:     ['ci', '--omit=dev'],
   },

   /** The installer's version, written as the marker's `version`. Keep equal to `package.json`. */
   version: '0.1.0',

   /** Folders the installer never removes, even when a removal leaves them empty. */
   keep: ['.kiro/prompts', '.kiro/skills', '.agents/skills'],

   /**
    * Files written only when absent, as a copy of an example the engine ships. A seed is never recorded in
    * the marker and never removed, so a later run leaves what the user did with it.
    */
   seeds: [
      { path: '.workflow/acp/drivers/registry.yaml', from: '.workflow/acp/drivers/registry.example.yaml' },
   ],

   /** Files the installer writes itself, with their text. They are never taken from the engine. */
   written: {
      '.amazonq/.gitignore':              '# Written by the installer.\nworkflow.log\n.timestamp-temp\n',
      '.workflow/.gitignore':             '# Written by the installer.\ninstalled.json\n',
      '.workflow/acp/drivers/.gitignore': '# Written by the installer.\nregistry.yaml\n',
   },

   deny: {
      /** A folder with one of these names is not entered, at any depth. */
      folders:  ['node_modules', '__tests__', '__integration__'],
      /** A file with one of these names is not copied, at any depth. */
      files:    ['registry.yaml'],
      /** A file whose name ends with one of these is not copied. */
      suffixes: ['-project.md'],
      /** Paths that are never copied: the installer writes or seeds four of them, one is a Working Directory. */
      paths:    [
         '.workflow/installed.json', '.workflow/.gitignore', '.workflow/work',
         '.workflow/acp/drivers/.gitignore', '.workflow/acp/drivers/registry.yaml',
      ],
   },
};

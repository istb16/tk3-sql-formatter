<script>
  import { TRANSLATIONS }           from './lib/i18n.js';
  import { DIALECTS, SAMPLE_SQL }   from './lib/constants.js';
  import { loadSettings, saveSettings } from './lib/settings.js';
  import { formatSql }              from './lib/formatter.js';
  import ToggleSwitch               from './lib/ToggleSwitch.svelte';

  const saved = loadSettings();

  // ── State ─────────────────────────────────────────────────────────────────
  let lang            = $state(saved.lang            ?? 'en');
  let dialect         = $state(saved.dialect         ?? 'mysql');
  let indentStyle     = $state(saved.indentStyle     ?? 'standard');
  let tabWidth        = $state(saved.tabWidth        ?? 2);
  let useTabs         = $state(saved.useTabs         ?? false);
  let keywordCase     = $state(saved.keywordCase     ?? 'upper');
  let identifierCase  = $state(saved.identifierCase  ?? 'preserve');
  let dataTypeCase    = $state(saved.dataTypeCase    ?? 'preserve');
  let functionCase    = $state(saved.functionCase    ?? 'upper');
  let logicalOpNl     = $state(saved.logicalOpNl     ?? 'before');
  let expressionWidth = $state(saved.expressionWidth ?? 50);
  let linesBetween    = $state(saved.linesBetween    ?? 1);
  let denseOperators  = $state(saved.denseOperators  ?? false);
  let nlBeforeSemi    = $state(saved.nlBeforeSemi    ?? false);
  let autoFormat      = $state(saved.autoFormat      ?? false);
  let compactLists    = $state(saved.compactLists    ?? false);
  let inputSql        = $state('');
  let outputSql       = $state('');
  let errorMsg        = $state('');
  let copyDone        = $state(false);

  // ── Derived ───────────────────────────────────────────────────────────────
  let t           = $derived(TRANSLATIONS[lang]);
  let statsIn     = $derived(calcStats(inputSql));
  let statsOut    = $derived(calcStats(outputSql));
  let caseOptions = $derived([
    { value: 'preserve', label: t.casePreserve },
    { value: 'upper',    label: t.caseUpper },
    { value: 'lower',    label: t.caseLower },
  ]);
  let caseRows = $derived([
    { label: t.caseKeyword,    id: 'keywordCase',    val: keywordCase,    set: (v) => { keywordCase    = v; } },
    { label: t.caseIdentifier, id: 'identifierCase', val: identifierCase, set: (v) => { identifierCase = v; } },
    { label: t.caseDataType,   id: 'dataTypeCase',   val: dataTypeCase,   set: (v) => { dataTypeCase   = v; } },
    { label: t.caseFunction,   id: 'functionCase',   val: functionCase,   set: (v) => { functionCase   = v; } },
  ]);

  // ── Effects ───────────────────────────────────────────────────────────────
  $effect(() => {
    if (autoFormat) {
      void [
        inputSql, dialect, indentStyle, tabWidth, useTabs,
        keywordCase, identifierCase, dataTypeCase, functionCase,
        logicalOpNl, expressionWidth, linesBetween,
        denseOperators, nlBeforeSemi, compactLists,
      ];
      doFormat();
    }
  });

  $effect(() => {
    saveSettings({
      lang, dialect, indentStyle, tabWidth, useTabs,
      keywordCase, identifierCase, dataTypeCase, functionCase,
      logicalOpNl, expressionWidth, linesBetween,
      denseOperators, nlBeforeSemi, autoFormat, compactLists,
    });
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function calcStats(sql) {
    if (!sql) return { lines: 0, chars: 0 };
    return { lines: sql.split('\n').length, chars: sql.length };
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function doFormat() {
    if (!inputSql.trim()) { outputSql = ''; errorMsg = ''; return; }
    try {
      outputSql = formatSql(inputSql, {
        language:              dialect,
        indentStyle,
        tabWidth:              Number(tabWidth),
        useTabs,
        keywordCase,
        identifierCase,
        dataTypeCase,
        functionCase,
        logicalOperatorNewline: logicalOpNl,
        expressionWidth:        Number(expressionWidth),
        linesBetweenQueries:    Number(linesBetween),
        denseOperators,
        newlineBeforeSemicolon: nlBeforeSemi,
        compactLists,
      });
      errorMsg = '';
    } catch (e) {
      errorMsg  = e.message;
      outputSql = '';
    }
  }

  async function copyOutput() {
    if (!outputSql) return;
    try {
      await navigator.clipboard.writeText(outputSql);
      copyDone = true;
      setTimeout(() => (copyDone = false), 2000);
    } catch {}
  }

  function loadSample() {
    inputSql = SAMPLE_SQL[dialect] ?? SAMPLE_SQL.mysql;
    if (autoFormat) doFormat();
  }

  function clearAll() {
    inputSql  = '';
    outputSql = '';
    errorMsg  = '';
  }

  function handleKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doFormat();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- LAYOUT ROOT -->
<div class="flex flex-col h-screen bg-slate-950 text-slate-200 overflow-hidden" style="font-family: ui-sans-serif, system-ui, sans-serif;">

  <!-- HEADER -->
  <header class="flex items-center gap-4 px-5 py-3 bg-slate-900 border-b border-slate-700 shrink-0">
    <div class="flex items-center gap-2">
      <img src="/favicon.svg" alt="" class="w-6 h-6 rounded" />
      <h1 class="text-base font-bold tracking-tight text-white m-0">SQL Formatter</h1>
    </div>

    <div class="flex items-center gap-2 ml-auto">
      <!-- Language switcher -->
      <div class="flex items-center rounded overflow-hidden border border-slate-600 text-xs font-semibold shrink-0">
        {#each [['en','EN'],['ja','JA']] as [val, label]}
          <button
            onclick={() => lang = val}
            class="px-2.5 py-1 cursor-pointer border-0 transition-colors
              {lang === val
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'}"
          >{label}</button>
        {/each}
      </div>

      <div class="w-px h-5 bg-slate-700 mx-1"></div>

      <ToggleSwitch bind:checked={autoFormat} label={t.autoFormat} />

      <button onclick={loadSample} class="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors cursor-pointer border-0">{t.sample}</button>
      <button onclick={clearAll}   class="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors cursor-pointer border-0">{t.clear}</button>
      <button onclick={doFormat}   class="px-4 py-1.5 text-sm font-semibold rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer border-0 shadow">
        {t.format} <span class="ml-1 text-xs opacity-60 font-normal">Ctrl+↵</span>
      </button>
    </div>
  </header>

  <!-- BODY -->
  <div class="flex flex-1 overflow-hidden">

    <!-- OPTIONS SIDEBAR -->
    <aside class="w-60 shrink-0 bg-slate-900 border-r border-slate-700 overflow-y-auto p-4 flex flex-col gap-4">

      <!-- Dialect -->
      <section>
        <h2 class="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2 m-0">{t.dialect}</h2>
        <div class="flex flex-col gap-1.5">
          {#each DIALECTS as d}
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="dialect" value={d.value} bind:group={dialect} class="accent-blue-500" />
              <span class="text-sm text-slate-300">{d.label}</span>
            </label>
          {/each}
        </div>
      </section>

      <hr class="border-slate-700 m-0" />

      <!-- Indent -->
      <section>
        <h2 class="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2 m-0">{t.indent}</h2>

        <div class="mb-3">
          <label for="indent-style" class="text-xs text-slate-400 block mb-1">{t.indentStyle}</label>
          <select id="indent-style" bind:value={indentStyle} class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500">
            <option value="standard">Standard</option>
            <option value="tabularLeft">Tabular Left</option>
            <option value="tabularRight">Tabular Right</option>
          </select>
        </div>

        <div class="mb-3">
          <label for="tab-width" class="text-xs text-slate-400 block mb-1">{t.tabWidth}: {tabWidth}</label>
          <input id="tab-width" type="range" min="1" max="8" bind:value={tabWidth} disabled={useTabs} class="w-full accent-blue-500 disabled:opacity-40" />
          <div class="flex justify-between text-xs text-slate-600 mt-0.5 select-none">
            <span>1</span><span>4</span><span>8</span>
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" bind:checked={useTabs} class="accent-blue-500" />
          <span class="text-sm text-slate-300">{t.useTabs}</span>
        </label>
      </section>

      <hr class="border-slate-700 m-0" />

      <!-- Case -->
      <section>
        <h2 class="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2 m-0">{t.caseSection}</h2>
        {#each caseRows as row}
          <div class="mb-2">
            <label for={row.id} class="text-xs text-slate-400 block mb-1">{row.label}</label>
            <select
              id={row.id}
              value={row.val}
              onchange={(e) => row.set(e.currentTarget.value)}
              class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            >
              {#each caseOptions as o}<option value={o.value}>{o.label}</option>{/each}
            </select>
          </div>
        {/each}
      </section>

      <hr class="border-slate-700 m-0" />

      <!-- Layout -->
      <section>
        <h2 class="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2 m-0">{t.layout}</h2>

        <div class="mb-3">
          <span class="text-xs text-slate-400 block mb-1">{t.logicalOpNl}</span>
          <div class="flex gap-4">
            {#each [['before', t.logicalBefore], ['after', t.logicalAfter]] as [v, l]}
              <label class="flex items-center gap-1.5 cursor-pointer text-sm text-slate-300">
                <input type="radio" name="logicalOpNl" value={v} bind:group={logicalOpNl} class="accent-blue-500" />
                {l}
              </label>
            {/each}
          </div>
        </div>

        <div class="mb-3">
          <label for="expr-width" class="text-xs text-slate-400 block mb-1">{t.exprWidth}: {expressionWidth}</label>
          <input id="expr-width" type="range" min="20" max="120" step="5" bind:value={expressionWidth} class="w-full accent-blue-500" />
          <div class="flex justify-between text-xs text-slate-600 mt-0.5 select-none">
            <span>20</span><span>70</span><span>120</span>
          </div>
        </div>

        <div class="mb-3">
          <span class="text-xs text-slate-400 block mb-1">{t.linesBetween}</span>
          <div class="flex gap-3">
            {#each [0, 1, 2] as n}
              <label class="flex items-center gap-1.5 cursor-pointer text-sm text-slate-300">
                <input type="radio" name="linesBetween" value={n} bind:group={linesBetween} class="accent-blue-500" />
                {n}
              </label>
            {/each}
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" bind:checked={denseOperators} class="accent-blue-500" />
          <span class="text-sm text-slate-300">{t.denseOperators}</span>
        </label>

        <label class="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" bind:checked={nlBeforeSemi} class="accent-blue-500" />
          <span class="text-sm text-slate-300">{t.nlBeforeSemi}</span>
        </label>

        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" bind:checked={compactLists} class="accent-blue-500" />
          <span class="text-sm text-slate-300">{t.compactLists}</span>
        </label>
      </section>

    </aside>

    <!-- EDITORS -->
    <div class="flex flex-1 overflow-hidden">

      <!-- Input panel -->
      <div class="flex flex-col flex-1 min-w-0 border-r border-slate-700">
        <div class="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700 shrink-0">
          <span class="text-xs font-semibold text-slate-400 uppercase tracking-widest">{t.inputSql}</span>
          <span class="text-xs text-slate-600">{statsIn.lines} {t.lines} / {statsIn.chars} {t.chars}</span>
        </div>
        <textarea
          bind:value={inputSql}
          spellcheck="false"
          placeholder={t.inputPlaceholder}
          class="flex-1 resize-none bg-slate-950 text-slate-100 text-sm p-4 focus:outline-none placeholder:text-slate-700 leading-relaxed"
          style="font-family: ui-monospace, Consolas, 'Courier New', monospace;"
        ></textarea>
      </div>

      <!-- Output panel -->
      <div class="flex flex-col flex-1 min-w-0">
        <div class="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700 shrink-0">
          <span class="text-xs font-semibold text-slate-400 uppercase tracking-widest">{t.outputSql}</span>
          <div class="flex items-center gap-3">
            <span class="text-xs text-slate-600">{statsOut.lines} {t.lines} / {statsOut.chars} {t.chars}</span>
            <button
              onclick={copyOutput}
              disabled={!outputSql}
              class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 transition-colors cursor-pointer border-0"
            >
              {#if copyDone}
                <svg class="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span class="text-green-400">{t.copied}</span>
              {:else}
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-4 10h6a2 2 0 002-2v-8a2 2 0 00-2-2h-6a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {t.copy}
              {/if}
            </button>
          </div>
        </div>

        {#if errorMsg}
          <div class="px-4 py-2 bg-red-950 border-b border-red-800 text-red-300 text-xs shrink-0" style="font-family: ui-monospace, Consolas, monospace;">
            <span class="font-semibold text-red-400">{t.errorPrefix}</span>{errorMsg}
          </div>
        {/if}

        <textarea
          bind:value={outputSql}
          spellcheck="false"
          placeholder={t.outputPlaceholder}
          class="flex-1 resize-none bg-slate-950 text-slate-100 text-sm p-4 focus:outline-none placeholder:text-slate-700 leading-relaxed"
          style="font-family: ui-monospace, Consolas, 'Courier New', monospace;"
        ></textarea>
      </div>

    </div>
  </div>

</div>

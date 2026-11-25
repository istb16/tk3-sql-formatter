<script>
  import { TRANSLATIONS, groupLabel, dialectLabel } from './lib/i18n.js';
  import { DIALECT_GROUPS, normalizeDialect, sampleFor } from './lib/constants.js';
  import { loadSettings, saveSettings } from './lib/settings.js';
  import { formatSql }              from './lib/formatter.js';
  import ToggleSwitch               from './lib/ToggleSwitch.svelte';

  const saved = loadSettings();

  // ── State ─────────────────────────────────────────────────────────────────
  let lang            = $state(saved.lang            ?? 'en');
  let dialect         = $state(normalizeDialect(saved.dialect));
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
  // Narrow screens only: whether the folded format options are open (not saved)
  let optionsOpen     = $state(false);
  let compactLists    = $state(saved.compactLists    ?? false);
  let ignoreTemplates = $state(saved.ignoreTemplates ?? false);
  let inputSql        = $state('');
  let outputSql       = $state('');
  let errorMsg        = $state('');
  let copyDone        = $state(false);
  let copyTimer;

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
        denseOperators, nlBeforeSemi, compactLists, ignoreTemplates,
      ];
      doFormat();
    }
  });

  $effect(() => {
    saveSettings({
      lang, dialect, indentStyle, tabWidth, useTabs,
      keywordCase, identifierCase, dataTypeCase, functionCase,
      logicalOpNl, expressionWidth, linesBetween,
      denseOperators, nlBeforeSemi, autoFormat, compactLists, ignoreTemplates,
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
        ignoreTemplates,
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
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copyDone = false), 2000);
    } catch {}
  }

  function loadSample() {
    inputSql = sampleFor(dialect);
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
<!-- Below lg (1024px) the page scrolls and the panes stack; from lg up it is the full-height three-column editor. -->
<div class="flex flex-col min-h-dvh lg:h-screen bg-bg text-ink lg:overflow-hidden">

  <!-- HEADER -->
  <header class="tk-header shrink-0 flex-wrap lg:flex-nowrap">
    <a class="tk-header__home" href="/">
      <img src="/icon.svg" alt="" class="tk-header__icon" />
      <h1 class="tk-header__name">SQL FORMATTER</h1>
    </a>

    <div class="tk-header__end flex-wrap lg:flex-nowrap w-full lg:w-auto">
      <!-- Language switcher -->
      <div class="flex items-center rounded border border-line text-xs font-semibold shrink-0">
        {#each [['en','EN'],['ja','JA']] as [val, label]}
          <button
            onclick={() => lang = val}
            aria-pressed={lang === val}
            class="px-2.5 py-1 cursor-pointer border-0 transition-colors first:rounded-l-[3px] last:rounded-r-[3px]
              {lang === val
                ? 'bg-accent text-on-accent'
                : 'bg-surface-2 text-muted hover:text-ink'}"
          >{label}</button>
        {/each}
      </div>

      <div class="hidden lg:block w-px h-5 bg-line mx-1"></div>

      <ToggleSwitch bind:checked={autoFormat} label={t.autoFormat} />

      <!-- Kept together so that on a narrow screen the three actions wrap as one row -->
      <div class="flex items-center gap-2">
        <button onclick={loadSample} class="tk-btn tk-btn--quiet">{t.sample}</button>
        <button onclick={clearAll}   class="tk-btn tk-btn--quiet">{t.clear}</button>
        <button onclick={doFormat}   class="tk-btn">
          {t.format} <span class="hidden lg:inline text-xs font-normal">Ctrl+↵</span>
        </button>
      </div>
    </div>
  </header>

  <!-- BODY -->
  <div class="flex flex-col lg:flex-row flex-1 lg:overflow-hidden">

    <!-- On a narrow screen the options are folded above the editors (closed at first) -->
    <button
      type="button"
      class="lg:hidden flex items-center justify-between px-4 h-11 bg-surface border-b border-line text-sm font-semibold text-ink cursor-pointer"
      aria-expanded={optionsOpen}
      aria-controls="format-options"
      onclick={() => (optionsOpen = !optionsOpen)}
    >
      {t.options}
      <svg class="w-4 h-4 transition-transform motion-reduce:transition-none {optionsOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- OPTIONS SIDEBAR -->
    <aside
      id="format-options"
      class="{optionsOpen ? 'flex' : 'hidden'} lg:flex w-full lg:w-60 shrink-0 bg-surface border-b lg:border-b-0 lg:border-r border-line lg:overflow-y-auto p-4 flex-col gap-4"
    >

      <!-- Dialect -->
      <section>
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2 m-0">{t.dialect}</h2>
        <select id="dialect" aria-label={t.dialect} bind:value={dialect} class="w-full bg-surface border border-line-strong rounded px-2 py-1.5 text-sm text-ink focus:border-accent">
          {#each DIALECT_GROUPS as g}
            <optgroup label={groupLabel(t, g.key)}>
              {#each g.dialects as d}
                <option value={d.value}>{dialectLabel(t, d)}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      </section>

      <hr class="border-line m-0" />

      <!-- Indent -->
      <section>
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2 m-0">{t.indent}</h2>

        <div class="mb-3">
          <label for="indent-style" class="text-xs text-muted block mb-1">{t.indentStyle}</label>
          <select id="indent-style" bind:value={indentStyle} class="w-full bg-surface border border-line-strong rounded px-2 py-1.5 text-sm text-ink focus:border-accent">
            <option value="standard">Standard</option>
            <option value="tabularLeft">Tabular Left</option>
            <option value="tabularRight">Tabular Right</option>
          </select>
        </div>

        <div class="mb-3">
          <label for="tab-width" class="text-xs text-muted block mb-1">{t.tabWidth}: {tabWidth}</label>
          <input id="tab-width" type="range" min="1" max="8" bind:value={tabWidth} disabled={useTabs} class="w-full disabled:opacity-40" />
          <div class="flex justify-between text-xs text-muted mt-0.5 select-none">
            <span>1</span><span>4</span><span>8</span>
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" bind:checked={useTabs} />
          <span class="text-sm text-body">{t.useTabs}</span>
        </label>
      </section>

      <hr class="border-line m-0" />

      <!-- Case -->
      <section>
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2 m-0">{t.caseSection}</h2>
        {#each caseRows as row}
          <div class="mb-2">
            <label for={row.id} class="text-xs text-muted block mb-1">{row.label}</label>
            <select
              id={row.id}
              value={row.val}
              onchange={(e) => row.set(e.currentTarget.value)}
              class="w-full bg-surface border border-line-strong rounded px-2 py-1.5 text-sm text-ink focus:border-accent"
            >
              {#each caseOptions as o}<option value={o.value}>{o.label}</option>{/each}
            </select>
          </div>
        {/each}
      </section>

      <hr class="border-line m-0" />

      <!-- Layout -->
      <section>
        <h2 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2 m-0">{t.layout}</h2>

        <div class="mb-3">
          <span class="text-xs text-muted block mb-1">{t.logicalOpNl}</span>
          <div class="flex gap-4">
            {#each [['before', t.logicalBefore], ['after', t.logicalAfter]] as [v, l]}
              <label class="flex items-center gap-1.5 cursor-pointer text-sm text-body">
                <input type="radio" name="logicalOpNl" value={v} bind:group={logicalOpNl} />
                {l}
              </label>
            {/each}
          </div>
        </div>

        <div class="mb-3">
          <label for="expr-width" class="text-xs text-muted block mb-1">{t.exprWidth}: {expressionWidth}</label>
          <input id="expr-width" type="range" min="50" max="200" step="5" bind:value={expressionWidth} class="w-full" />
          <div class="flex justify-between text-xs text-muted mt-0.5 select-none">
            <span>50</span><span>125</span><span>200</span>
          </div>
        </div>

        <div class="mb-3">
          <span class="text-xs text-muted block mb-1">{t.linesBetween}</span>
          <div class="flex gap-3">
            {#each [0, 1, 2] as n}
              <label class="flex items-center gap-1.5 cursor-pointer text-sm text-body">
                <input type="radio" name="linesBetween" value={n} bind:group={linesBetween} />
                {n}
              </label>
            {/each}
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" bind:checked={denseOperators} />
          <span class="text-sm text-body">{t.denseOperators}</span>
        </label>

        <label class="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" bind:checked={nlBeforeSemi} />
          <span class="text-sm text-body">{t.nlBeforeSemi}</span>
        </label>

        <label class="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" bind:checked={compactLists} />
          <span class="text-sm text-body">{t.compactLists}</span>
        </label>

        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" bind:checked={ignoreTemplates} />
          <span class="text-sm text-body">{t.ignoreTemplates}</span>
        </label>
      </section>

    </aside>

    <!-- EDITORS -->
    <div class="flex flex-col lg:flex-row flex-1 lg:overflow-hidden">

      <!-- Input panel -->
      <div class="flex flex-col h-[45svh] lg:h-auto lg:flex-1 min-w-0 border-b lg:border-b-0 lg:border-r border-line">
        <div class="flex items-center justify-between h-11 px-4 bg-surface border-b border-line shrink-0">
          <span class="text-xs font-semibold text-muted uppercase tracking-widest">{t.inputSql}</span>
          <span class="text-xs text-muted">{statsIn.lines} {t.lines} / {statsIn.chars} {t.chars}</span>
        </div>
        <textarea
          bind:value={inputSql}
          spellcheck="false"
          placeholder={t.inputPlaceholder}
          class="editor flex-1 resize-none bg-bg text-ink font-mono text-sm p-4 placeholder:text-muted leading-relaxed"
        ></textarea>
      </div>

      <!-- Output panel -->
      <div class="flex flex-col h-[45svh] lg:h-auto lg:flex-1 min-w-0">
        <div class="flex items-center justify-between h-11 px-4 bg-surface border-b border-line shrink-0">
          <span class="text-xs font-semibold text-muted uppercase tracking-widest">{t.outputSql}</span>
          <div class="flex items-center gap-3">
            <span class="text-xs text-muted">{statsOut.lines} {t.lines} / {statsOut.chars} {t.chars}</span>
            <button
              onclick={copyOutput}
              disabled={!outputSql}
              class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-line bg-surface text-body enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {#if copyDone}
                <svg class="w-3.5 h-3.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span class="text-success">{t.copied}</span>
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
          <div class="px-4 py-2 bg-danger/10 border-b border-danger/40 text-danger text-xs font-mono shrink-0">
            <span class="font-semibold">{t.errorPrefix}</span>{errorMsg}
          </div>
        {/if}

        <textarea
          bind:value={outputSql}
          spellcheck="false"
          placeholder={t.outputPlaceholder}
          class="editor flex-1 resize-none bg-bg text-ink font-mono text-sm p-4 placeholder:text-muted leading-relaxed"
        ></textarea>
      </div>

    </div>
  </div>

  <footer class="tk-footer app-footer shrink-0">
    <a href="https://tk3.biz/">tk3.biz</a>
  </footer>

</div>

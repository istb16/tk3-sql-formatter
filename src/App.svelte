<script>
  import { format } from 'sql-formatter';

  // ── i18n ──────────────────────────────────────────────────────────────────
  const TRANSLATIONS = {
    ja: {
      autoFormat:        '自動整形',
      sample:            'サンプル',
      clear:             'クリア',
      format:            '整形',
      dialect:           'ダイアレクト',
      indent:            'インデント',
      indentStyle:       'スタイル',
      tabWidth:          'タブ幅',
      useTabs:           'タブ文字を使用',
      caseSection:       '大文字/小文字',
      caseKeyword:       'キーワード',
      caseIdentifier:    '識別子',
      caseDataType:      'データ型',
      caseFunction:      '関数名',
      casePreserve:      'そのまま',
      caseUpper:         '大文字',
      caseLower:         '小文字',
      layout:            'レイアウト',
      logicalOpNl:       '論理演算子の改行位置',
      logicalBefore:     '前',
      logicalAfter:      '後',
      exprWidth:         '最大式幅',
      linesBetween:      'クエリ間の空行数',
      denseOperators:    '演算子を密に配置',
      nlBeforeSemi:      'セミコロン前に改行',
      compactLists:      'コンパクト表示',
      inputSql:          '入力 SQL',
      outputSql:         '整形済み SQL',
      lines:             '行',
      chars:             '文字',
      inputPlaceholder:  'ここに SQL を貼り付けてください…',
      outputPlaceholder: '整形結果がここに表示されます…',
      copy:              'コピー',
      copied:            'コピー完了',
      errorPrefix:       'エラー: ',
    },
    en: {
      autoFormat:        'Auto Format',
      sample:            'Sample',
      clear:             'Clear',
      format:            'Format',
      dialect:           'Dialect',
      indent:            'Indent',
      indentStyle:       'Style',
      tabWidth:          'Tab Width',
      useTabs:           'Use Tabs',
      caseSection:       'Case',
      caseKeyword:       'Keywords',
      caseIdentifier:    'Identifiers',
      caseDataType:      'Data Types',
      caseFunction:      'Functions',
      casePreserve:      'Preserve',
      caseUpper:         'Upper',
      caseLower:         'Lower',
      layout:            'Layout',
      logicalOpNl:       'Logical Operator Newline',
      logicalBefore:     'Before',
      logicalAfter:      'After',
      exprWidth:         'Max Expression Width',
      linesBetween:      'Lines Between Queries',
      denseOperators:    'Dense Operators',
      nlBeforeSemi:      'Newline Before Semicolon',
      compactLists:      'Compact mode',
      inputSql:          'Input SQL',
      outputSql:         'Formatted SQL',
      lines:             'lines',
      chars:             'chars',
      inputPlaceholder:  'Paste your SQL here…',
      outputPlaceholder: 'Formatted SQL will appear here…',
      copy:              'Copy',
      copied:            'Copied!',
      errorPrefix:       'Error: ',
    },
  };

  // ── Static data ───────────────────────────────────────────────────────────
  const DIALECTS = [
    { value: 'mysql',       label: 'MySQL' },
    { value: 'postgresql',  label: 'PostgreSQL' },
    { value: 'snowflake',   label: 'Snowflake' },
    { value: 'plsql',       label: 'Oracle (PL/SQL)' },
    { value: 'transactsql', label: 'SQL Server (T-SQL)' },
  ];

  const SAMPLE_SQL = {
    mysql:       `select u.id, u.name, u.email, o.total_amount, o.created_at from users u inner join orders o on u.id = o.user_id where u.status = 'active' and o.total_amount > 1000 order by o.created_at desc limit 20;`,
    postgresql:  `select u.id, u.name, array_agg(t.name) as tags from users u left join user_tags ut on u.id = ut.user_id left join tags t on ut.tag_id = t.id where u.created_at >= now() - interval '30 days' group by u.id, u.name having count(t.id) > 0 order by u.id;`,
    snowflake:   `select date_trunc('month', sale_date) as month, region, sum(revenue) as total_revenue, count(distinct customer_id) as unique_customers from sales_fact where year(sale_date) = 2024 group by 1, 2 order by 1, 2;`,
    plsql:       `select e.employee_id, e.first_name, e.last_name, d.department_name, j.job_title from employees e join departments d on e.department_id = d.department_id join jobs j on e.job_id = j.job_id where e.employee_id = :EMPLOYEE_ID and e.status = :STATUS and d.location_id in (select location_id from locations where country_id = :COUNTRY_ID) order by e.last_name, e.first_name;`,
    transactsql: `select top 100 c.customer_id, c.customer_name, sum(od.quantity * od.unit_price) as total_spent from customers c inner join orders o on c.customer_id = o.customer_id inner join order_details od on o.order_id = od.order_id where o.order_date between '2024-01-01' and '2024-12-31' group by c.customer_id, c.customer_name having sum(od.quantity * od.unit_price) > 5000 order by total_spent desc;`,
  };

  // ── localStorage persistence ──────────────────────────────────────────────
  const STORAGE_KEY = 'sql-formatter-settings';

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

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
  let t         = $derived(TRANSLATIONS[lang]);
  let statsIn   = $derived(calcStats(inputSql));
  let statsOut  = $derived(calcStats(outputSql));
  let caseOptions = $derived([
    { value: 'preserve', label: t.casePreserve },
    { value: 'upper',    label: t.caseUpper },
    { value: 'lower',    label: t.caseLower },
  ]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  /**
   * Step 1: Collapse multi-line (...) blocks that contain no nested parens and
   * no subquery-level keywords (SELECT).
   *
   * This fixes sql-formatter's habit of expanding EXTRACT(YEAR FROM date) and
   * similar constructs across multiple lines because FROM is a SQL keyword.
   *
   * Runs repeatedly until no more collapses are possible (handles nesting).
   */
  function collapseParenBlocks(sql) {
    let prev = '';
    let result = sql;
    while (prev !== result) {
      prev = result;
      result = result.replace(
        /\((\n[\t ]+[^()\n]+)+\n[\t ]*\)/g,
        (match) => {
          const inner = match
            .slice(1, -1)
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean);
          // Never collapse subqueries
          if (inner.some(l => /^SELECT\b/i.test(l))) return match;
          return '(' + inner.join(' ') + ')';
        }
      );
    }
    return result;
  }

  /**
   * Step 2: Pull keyword lines and their indented children onto one line when
   * the children form a joinable list:
   *   - comma-separated  → SELECT a, b / FROM t1, t2 / ORDER BY c1, c2
   *   - AND/OR-connected → WHERE c1 AND c2 AND c3
   *   - single child     → FROM table / SELECT *
   *
   * "SELECT\n  a,\n  b"  → "SELECT a, b"
   * "WHERE\n  c1\n  AND c2" → "WHERE c1 AND c2"
   * "FROM\n  table"      → "FROM table"
   * "FROM\n  ("          → "FROM ("  (opening paren of a subquery)
   *
   * Safety: when a child list contains a bare "(" followed by deeper lines
   * (subquery body), the group size is > 1 but the comma/AND/OR checks fail,
   * so the subquery body stays intact.
   */
  function joinCompactLists(sql) {
    const lines = sql.split('\n');
    const out   = [];
    let i = 0;

    while (i < lines.length) {
      const cur       = lines[i];
      const curIndent = cur.search(/\S/); // -1 if blank

      if (i + 1 < lines.length) {
        const nextIndent = lines[i + 1].search(/\S/);

        if (nextIndent > curIndent && nextIndent >= 0) {
          // Collect consecutive lines at exactly nextIndent
          const group = [];
          let j = i + 1;
          while (j < lines.length && lines[j].search(/\S/) === nextIndent) {
            group.push(lines[j].trim());
            j++;
          }

          if (group.length >= 1) {
            const isCommaList =
              group.length === 1 ||
              group.slice(0, -1).every(l => l.endsWith(','));
            const isAndOrBefore =
              group.length > 1 &&
              group.slice(1).every(l => /^(AND|OR)\s/i.test(l));
            const isAndOrAfter =
              group.length > 1 &&
              group.slice(0, -1).every(l => /\s(AND|OR)$/i.test(l));

            // When a comma-list ends with bare "(" the last item is the opening
            // of a subquery (e.g. SELECT col1, col2, (SELECT ...)).
            // A single "(" group is fine ("FROM\n  (" → "FROM (").
            const endsWithSubquery =
              group.length > 1 && group[group.length - 1] === '(';

            if (!endsWithSubquery && (isCommaList || isAndOrBefore || isAndOrAfter)) {
              out.push(cur.trimEnd() + ' ' + group.join(' '));
              i = j;
              continue;
            }
          }
        }
      }

      out.push(cur);
      i++;
    }

    return out.join('\n');
  }

  function calcStats(sql) {
    if (!sql) return { lines: 0, chars: 0 };
    return { lines: sql.split('\n').length, chars: sql.length };
  }

  function doFormat() {
    if (!inputSql.trim()) {
      outputSql = '';
      errorMsg  = '';
      return;
    }
    try {
      let result = format(inputSql, {
        language:               dialect,
        indentStyle,
        tabWidth:               Number(tabWidth),
        useTabs,
        keywordCase,
        identifierCase,
        dataTypeCase,
        functionCase,
        logicalOperatorNewline: logicalOpNl,
        // compactLists: suppress all expression-level wrapping first
        expressionWidth:        compactLists ? 9999 : Number(expressionWidth),
        linesBetweenQueries:    Number(linesBetween),
        denseOperators,
        newlineBeforeSemicolon: nlBeforeSemi,
      });
      if (compactLists) {
        result = collapseParenBlocks(result); // fix EXTRACT(YEAR FROM ...) etc.
        result = joinCompactLists(result);    // inline SELECT/FROM/WHERE/... lists
      }
      outputSql = result;
      errorMsg  = '';
    } catch (e) {
      errorMsg  = e.message;
      outputSql = '';
    }
  }

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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        lang, dialect, indentStyle, tabWidth, useTabs,
        keywordCase, identifierCase, dataTypeCase, functionCase,
        logicalOpNl, expressionWidth, linesBetween,
        denseOperators, nlBeforeSemi, autoFormat, compactLists,
      }));
    } catch {}
  });

  function handleKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      doFormat();
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

      <!-- Auto format toggle -->
      <label class="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
        <span class="relative inline-flex h-5 w-9 shrink-0">
          <input type="checkbox" bind:checked={autoFormat} class="peer sr-only" />
          <span class="absolute inset-0 rounded-full bg-slate-700 transition-colors peer-checked:bg-blue-600"></span>
          <span class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4"></span>
        </span>
        {t.autoFormat}
      </label>

      <button
        onclick={loadSample}
        class="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors cursor-pointer border-0"
      >{t.sample}</button>

      <button
        onclick={clearAll}
        class="px-3 py-1.5 text-sm rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors cursor-pointer border-0"
      >{t.clear}</button>

      <button
        onclick={doFormat}
        class="px-4 py-1.5 text-sm font-semibold rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer border-0 shadow"
      >
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
          <input id="tab-width" type="range" min="1" max="8" bind:value={tabWidth} disabled={useTabs}
            class="w-full accent-blue-500 disabled:opacity-40" />
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

        {#each [
          [t.caseKeyword,    'keywordCase',    keywordCase,    (v) => { keywordCase    = v; }],
          [t.caseIdentifier, 'identifierCase', identifierCase, (v) => { identifierCase = v; }],
          [t.caseDataType,   'dataTypeCase',   dataTypeCase,   (v) => { dataTypeCase   = v; }],
          [t.caseFunction,   'functionCase',   functionCase,   (v) => { functionCase   = v; }],
        ] as [label, id, val, setter]}
          <div class="mb-2">
            <label for={id} class="text-xs text-slate-400 block mb-1">{label}</label>
            <select
              {id}
              value={val}
              onchange={(e) => setter(e.currentTarget.value)}
              class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            >
              {#each caseOptions as o}<option value={o.value}>{o.label}</option>{/each}
            </select>
          </div>
        {/each}
      </section>

      <hr class="border-slate-700 m-0" />

      <!-- Layout options -->
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
          <input id="expr-width" type="range" min="20" max="120" step="5" bind:value={expressionWidth}
            class="w-full accent-blue-500" />
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

      <!-- Input -->
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

      <!-- Output -->
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

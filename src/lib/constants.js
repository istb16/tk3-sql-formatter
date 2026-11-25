/**
 * The SQL dialects sql-formatter supports, grouped so the select stays
 * readable at 20 entries. `group` refers to a key in `t.dialectGroups`, and a
 * dialect whose product name is not a proper noun (`sql`) takes its label from
 * `t.dialectLabels` instead of the `label` here.
 *
 * `tsql` is sql-formatter's alias for `transactsql`; only one of the two is
 * listed. Every other value in `supportedDialects` appears exactly once —
 * `constants.test.js` checks that against sql-formatter itself.
 */
const GROUPED_DIALECTS = [
  ['standard', [
    { value: 'sql',           label: 'Standard SQL' },
  ]],
  ['mysqlFamily', [
    { value: 'mysql',         label: 'MySQL' },
    { value: 'mariadb',       label: 'MariaDB' },
    { value: 'tidb',          label: 'TiDB' },
    { value: 'singlestoredb', label: 'SingleStore' },
  ]],
  ['postgresFamily', [
    { value: 'postgresql',    label: 'PostgreSQL' },
    { value: 'redshift',      label: 'Amazon Redshift' },
  ]],
  ['enterprise', [
    { value: 'plsql',         label: 'Oracle (PL/SQL)' },
    { value: 'transactsql',   label: 'SQL Server (T-SQL)' },
    { value: 'db2',           label: 'IBM Db2' },
    { value: 'db2i',          label: 'IBM Db2 for i' },
  ]],
  ['warehouse', [
    { value: 'bigquery',      label: 'Google BigQuery' },
    { value: 'snowflake',     label: 'Snowflake' },
  ]],
  ['analytics', [
    { value: 'spark',         label: 'Apache Spark SQL' },
    { value: 'hive',          label: 'Apache Hive' },
    { value: 'trino',         label: 'Trino / Presto' },
    { value: 'clickhouse',    label: 'ClickHouse' },
    { value: 'duckdb',        label: 'DuckDB' },
  ]],
  ['embedded', [
    { value: 'sqlite',        label: 'SQLite' },
    { value: 'n1ql',          label: 'Couchbase (N1QL)' },
  ]],
];

/** The groups in display order: `{ key, dialects }`. */
export const DIALECT_GROUPS = GROUPED_DIALECTS.map(([key, dialects]) => ({
  key,
  dialects: dialects.map(d => ({ ...d, group: key })),
}));

/** Every dialect, flattened, in the same order. */
export const DIALECTS = DIALECT_GROUPS.flatMap(g => g.dialects);

export const DEFAULT_DIALECT = 'mysql';

/** The dialect to use for a stored value, falling back when it is unknown. */
export function normalizeDialect(value) {
  return DIALECTS.some(d => d.value === value) ? value : DEFAULT_DIALECT;
}

/**
 * Sample SQL per dialect. Only the dialects with something worth showing off
 * have their own sample; the rest fall back to `GENERIC_SAMPLE`, which is
 * plain enough to parse in every dialect.
 */
const GENERIC_SAMPLE = `select c.id, c.name, sum(o.amount) as total_amount from customers c join orders o on o.customer_id = c.id where c.status = 'active' group by c.id, c.name having sum(o.amount) > 1000 order by total_amount desc;`;

export const SAMPLE_SQL = {
  sql:         GENERIC_SAMPLE,
  mysql:       `select u.id, u.name, u.email, o.total_amount, o.created_at from users u inner join orders o on u.id = o.user_id where u.status = 'active' and o.total_amount > 1000 order by o.created_at desc limit 20;`,
  postgresql:  `select u.id, u.name, array_agg(t.name) as tags from users u left join user_tags ut on u.id = ut.user_id left join tags t on ut.tag_id = t.id where u.created_at >= now() - interval '30 days' group by u.id, u.name having count(t.id) > 0 order by u.id;`,
  snowflake:   `select date_trunc('month', sale_date) as month, region, sum(revenue) as total_revenue, count(distinct customer_id) as unique_customers from sales_fact where year(sale_date) = 2024 group by 1, 2 order by 1, 2;`,
  plsql:       `select e.employee_id, e.first_name, e.last_name, d.department_name, j.job_title from employees e join departments d on e.department_id = d.department_id join jobs j on e.job_id = j.job_id where e.employee_id = :EMPLOYEE_ID and e.status = :STATUS and d.location_id in (select location_id from locations where country_id = :COUNTRY_ID) order by e.last_name, e.first_name;`,
  transactsql: `select top 100 c.customer_id, c.customer_name, sum(od.quantity * od.unit_price) as total_spent from customers c inner join orders o on c.customer_id = o.customer_id inner join order_details od on o.order_id = od.order_id where o.order_date between '2024-01-01' and '2024-12-31' group by c.customer_id, c.customer_name having sum(od.quantity * od.unit_price) > 5000 order by total_spent desc;`,
  bigquery:    `select a.* from \`proj.ds.tbl\` a where date(ts) = current_date() and a.arr[offset(0)] = 1 qualify row_number() over (partition by a.id order by ts desc) = 1;`,
};

/** The sample for a dialect, falling back to one that parses anywhere. */
export function sampleFor(dialect) {
  return SAMPLE_SQL[dialect] ?? SAMPLE_SQL.sql;
}

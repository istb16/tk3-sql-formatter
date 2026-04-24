export const DIALECTS = [
  { value: 'mysql',       label: 'MySQL' },
  { value: 'postgresql',  label: 'PostgreSQL' },
  { value: 'snowflake',   label: 'Snowflake' },
  { value: 'plsql',       label: 'Oracle (PL/SQL)' },
  { value: 'transactsql', label: 'SQL Server (T-SQL)' },
];

export const SAMPLE_SQL = {
  mysql:       `select u.id, u.name, u.email, o.total_amount, o.created_at from users u inner join orders o on u.id = o.user_id where u.status = 'active' and o.total_amount > 1000 order by o.created_at desc limit 20;`,
  postgresql:  `select u.id, u.name, array_agg(t.name) as tags from users u left join user_tags ut on u.id = ut.user_id left join tags t on ut.tag_id = t.id where u.created_at >= now() - interval '30 days' group by u.id, u.name having count(t.id) > 0 order by u.id;`,
  snowflake:   `select date_trunc('month', sale_date) as month, region, sum(revenue) as total_revenue, count(distinct customer_id) as unique_customers from sales_fact where year(sale_date) = 2024 group by 1, 2 order by 1, 2;`,
  plsql:       `select e.employee_id, e.first_name, e.last_name, d.department_name, j.job_title from employees e join departments d on e.department_id = d.department_id join jobs j on e.job_id = j.job_id where e.employee_id = :EMPLOYEE_ID and e.status = :STATUS and d.location_id in (select location_id from locations where country_id = :COUNTRY_ID) order by e.last_name, e.first_name;`,
  transactsql: `select top 100 c.customer_id, c.customer_name, sum(od.quantity * od.unit_price) as total_spent from customers c inner join orders o on c.customer_id = o.customer_id inner join order_details od on o.order_id = od.order_id where o.order_date between '2024-01-01' and '2024-12-31' group by c.customer_id, c.customer_name having sum(od.quantity * od.unit_price) > 5000 order by total_spent desc;`,
};

<script>
  let { checked = $bindable(), label = '' } = $props();
</script>

<label class="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
  <span class="relative inline-flex h-5 w-9 shrink-0">
    <input type="checkbox" bind:checked class="peer sr-only" />
    <span class="absolute inset-0 rounded-full bg-slate-700 transition-colors peer-checked:bg-blue-600"></span>
    <span class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4"></span>
  </span>
  {label}
</label>

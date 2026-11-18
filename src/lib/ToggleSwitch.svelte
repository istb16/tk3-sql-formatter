<script>
  let { checked = $bindable(), label = '' } = $props();
</script>

<label class="flex items-center gap-2 text-sm text-body cursor-pointer select-none">
  <span class="relative inline-flex h-5 w-9 shrink-0">
    <input type="checkbox" bind:checked class="peer sr-only" />
    <span class="absolute inset-0 rounded-full bg-muted transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"></span>
    <span class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform peer-checked:translate-x-4"></span>
  </span>
  {label}
</label>

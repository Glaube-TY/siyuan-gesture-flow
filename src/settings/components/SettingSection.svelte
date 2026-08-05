<script lang="ts">
    /**
     * A card-style section container for grouped settings rows.
     *
     * Svelte 4 compatible — uses `<slot />` for content projection,
     * no runes or snippets.
     */
    export let title: string | null = null;
</script>

<section class="gf-section">
    {#if title}
        <h3 class="gf-section-title">{title}</h3>
    {/if}
    <div class="gf-section-card">
        <slot />
    </div>
</section>

<style>
    .gf-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .gf-section-title {
        margin: 0;
        padding: 0 4px;
        font-size: 13px;
        font-weight: 600;
        color: var(--b3-theme-on-surface, #626262);
        text-transform: none;
        white-space: nowrap;
    }
    .gf-section-card {
        background: var(--b3-theme-surface, #fff);
        border: 1px solid var(--b3-border-color, #e9e9ea);
        border-radius: 8px;
        padding: 4px 16px;
    }
</style>

<script lang="ts">
    /**
     * A single setting row: title + description on the left,
     * control slot on the right.  Rows within a SettingSection
     * are separated by a thin divider (except the last).
     *
     * Svelte 4 compatible — uses `<slot />` for the control and
     * `<slot name="info">` for optional custom left-side content.
     */
    export let title: string | null = null;
    export let description: string | null = null;
    export let last: boolean = false;
</script>

<div class="gf-row" class:gf-row-last={last}>
    <div class="gf-row-info">
        <slot name="info">
            <span class="gf-row-title">{title}</span>
            {#if description}
                <span class="gf-row-desc">{description}</span>
            {/if}
        </slot>
    </div>
    <div class="gf-row-control">
        <slot />
    </div>
</div>

<style>
    .gf-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 12px 0;
        border-bottom: 1px solid var(--b3-border-color, #e9e9ea);
    }
    .gf-row-last {
        border-bottom: none;
    }
    .gf-row-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1 1 auto;
        min-width: 0;
    }
    .gf-row-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--b3-theme-on-surface, #1f2329);
        white-space: nowrap;
    }
    .gf-row-desc {
        font-size: 12px;
        line-height: 1.5;
        color: var(--b3-theme-on-surface-light, #9aa0a6);
        word-break: normal;
        overflow-wrap: break-word;
    }
    .gf-row-control {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    /* Narrow screens: stack control below info */
    @media (max-width: 600px) {
        .gf-row {
            flex-direction: column;
            align-items: flex-start;
        }
        .gf-row-control {
            width: 100%;
            justify-content: flex-end;
        }
    }
</style>

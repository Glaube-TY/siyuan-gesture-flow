import type * as kernel from "siyuan/kernel";

const api: kernel.ISiyuan = siyuan;

/**
 * Kernel plugin stub.
 *
 * Business logic is intentionally NOT implemented in the kernel plugin for now.
 * Gesture handling runs entirely in the frontend (see src/index.ts).
 */
api.plugin.lifecycle.onload = async () => {
    await api.logger.info(`[${api.plugin.name}] kernel plugin loading`);
};

api.plugin.lifecycle.onrunning = async () => {
    await api.logger.info(`[${api.plugin.name}] kernel plugin running`);
};

api.plugin.lifecycle.onunload = async () => {
    await api.logger.info(`[${api.plugin.name}] kernel plugin unloading`);
};

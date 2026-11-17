import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, X } from 'lucide-react';
import { useApp } from '../context/AppContext';

export function Toast() {
  const { toast, dismissToast } = useApp();

  return (
    <div
      className="fixed bottom-5 right-5 z-50 pointer-events-none max-w-sm w-[calc(100vw-2.5rem)] sm:w-auto"
      aria-live="polite"
    >
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border border-[#264653]/10 bg-[#264653] text-[#FAF7F2]"
          >
            {toast.tone === 'teal' ? (
              <CheckCircle2 className="w-4 h-4 text-[#2A9D8F] shrink-0" aria-hidden="true" />
            ) : toast.tone === 'terracotta' ? (
              <CheckCircle2 className="w-4 h-4 text-[#E76F51] shrink-0" aria-hidden="true" />
            ) : (
              <Info className="w-4 h-4 text-[#F4EDE4]/80 shrink-0" aria-hidden="true" />
            )}
            <span className="text-sm font-medium leading-snug">{toast.message}</span>
            <button
              type="button"
              onClick={dismissToast}
              className="ml-2 p-1 rounded-md text-[#F4EDE4]/70 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

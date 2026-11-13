import { FullScreenFormBuilderModal } from "./FullScreenFormBuilderModal";
import type { Flow } from "@/lib/quoteflow/types";

export interface ClientOnlyFormBuilderProps {
  flow: Flow;
  onSaveFlow?: (patch: Partial<Flow>) => void;
  workspaceBrandColor?: string;
  onClose?: () => void;
}

export function ClientOnlyFormBuilder({
  flow,
  onSaveFlow,
  workspaceBrandColor = "#0f766e",
  onClose,
}: ClientOnlyFormBuilderProps) {
  return (
    <FullScreenFormBuilderModal
      open={true}
      flow={flow}
      onClose={() => onClose?.()}
      onSaveSuccess={(updated) => onSaveFlow?.(updated)}
      workspaceBrandColor={workspaceBrandColor}
    />
  );
}

export { FullScreenFormBuilderModal };
export type { FullScreenFormBuilderModalProps } from "./FullScreenFormBuilderModal";

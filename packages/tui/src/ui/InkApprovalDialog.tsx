import React from 'react';
import { render } from 'ink';
import { ApprovalDialog } from '../ink-ui/components/ApprovalDialog.js';
import type { PendingApproval } from '../ink-ui/hooks/useReactApprovalHandler.js';

export type ApprovalResult = 'approve' | 'deny' | 'yolo';

interface ApprovalDialogAppProps {
  request: { toolName: string; toolInput: any; reason: string; timestamp: Date };
  onComplete: (result: ApprovalResult) => void;
}

const ApprovalDialogApp: React.FC<ApprovalDialogAppProps> = ({
  request,
  onComplete,
}) => {
  const pendingApproval: PendingApproval = {
    request,
    resolve: () => {},
  };

  return (
    <ApprovalDialog
      pendingApproval={pendingApproval}
      onApprove={() => onComplete('approve')}
      onDeny={() => onComplete('deny')}
      onApproveAndYolo={() => onComplete('yolo')}
    />
  );
};

export async function showApprovalDialog(
  request: { toolName: string; toolInput: any; reason: string; timestamp: Date }
): Promise<ApprovalResult> {
  return new Promise((resolve) => {
    const { unmount, clear, waitUntilExit } = render(
      <ApprovalDialogApp
        request={request}
        onComplete={(result) => {
          clear();
          unmount();
          resolve(result);
        }}
      />
    );

    waitUntilExit().catch(() => {
      clear();
      unmount();
      resolve('deny');
    });
  });
}

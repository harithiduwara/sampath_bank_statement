import { FileUp, Inbox } from "lucide-react";
import { useWorkspace } from "../state/store";
import { Button, Card, EmptyState } from "../components/ui";

/** Shown by every data view before any statement has been read. */
export function NoData({ onUpload, what }: { onUpload: () => void; what: string }) {
  const { busy } = useWorkspace();
  return (
    <Card>
      <EmptyState
        icon={<Inbox size={22} aria-hidden="true" />}
        title={busy ? "Reading your statements…" : `No ${what} yet`}
        action={
          !busy && (
            <Button variant="primary" icon={<FileUp size={15} aria-hidden="true" />} onClick={onUpload}>
              Upload statements
            </Button>
          )
        }
      >
        {busy ? "This page fills in as soon as the first statement is processed." : "Upload one or more bank statements to see them here."}
      </EmptyState>
    </Card>
  );
}

/** When the selected period holds no transactions. */
export function EmptyPeriod() {
  const { actions } = useWorkspace();
  return (
    <Card>
      <EmptyState icon={<Inbox size={22} aria-hidden="true" />} title="No transactions in this period" action={<Button onClick={() => actions.setPeriod("all")}>Show all data</Button>}>
        Pick another period, or show everything that has been uploaded.
      </EmptyState>
    </Card>
  );
}

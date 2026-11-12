import { ApplyQueueView } from "@/components/apply-queue/apply-queue-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Apply Review",
  description: "Review the applications the agents prepared, then submit them yourself.",
};

export default function ApplyQueuePage() {
  return <ApplyQueueView />;
}

import { ActivityView } from "@/components/activity/activity-view";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Daily Activity",
  description: "What the agents did each day — scans, matches, and applications prepared for review.",
};

export default function ActivityPage() {
  return <ActivityView />;
}

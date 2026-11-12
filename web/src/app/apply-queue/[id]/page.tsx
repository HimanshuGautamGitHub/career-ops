"use client";

import { use } from "react";
import { ApplyReviewView } from "@/components/apply-queue/apply-review-view";

export default function ApplyReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ApplyReviewView id={id} />;
}

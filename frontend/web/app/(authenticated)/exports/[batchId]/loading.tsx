import React from "react";
import {
  Skeleton,
  SkeletonPageBody,
  SkeletonTable,
} from "../../../../components/ui/skeleton";

export default function ExportBatchLoading() {
  return (
    <SkeletonPageBody>
      <Skeleton height="1.5rem" width="12rem" />
      <SkeletonTable columns={4} rows={4} />
    </SkeletonPageBody>
  );
}

import React from "react";
import { Skeleton, SkeletonPageBody } from "../../../components/ui/skeleton";

export default function RunsLoading() {
  return (
    <SkeletonPageBody>
      <Skeleton height="1.25rem" width="10rem" />
    </SkeletonPageBody>
  );
}

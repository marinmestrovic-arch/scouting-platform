import { redirect } from "next/navigation";

export default function CampaignsPage() {
  redirect("/database?tab=campaigns");
}

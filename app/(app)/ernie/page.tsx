import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";
import ErnieChatClient from "@/components/ErnieChatClient";

export default async function ErniePage() {
  const profile = await getProfile();
  if (profile?.role !== "admin") {
    redirect("/inventory");
  }
  return <ErnieChatClient />;
}

import { redirect } from "next/navigation";
import { getProfile } from "@/lib/getProfile";

export default async function Home() {
  const profile = await getProfile();
  redirect(profile?.role === "admin" ? "/dashboard" : "/inventory");
}

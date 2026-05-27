import { redirect } from "next/navigation";

// /pulse 是历史路径，现在 Home (/) 已经是 heatmap
export default function PulseRedirect() {
  redirect("/");
}

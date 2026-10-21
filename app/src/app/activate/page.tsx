"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Activation now happens before anything else (see Boot in lib/pos-store.tsx). This route only exists so old
// links keep working: an activated PC goes to the login screen.
export default function ActivatePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return null;
}

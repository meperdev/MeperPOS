"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoadingState } from "@/components/ui/LoadingState";
import { Loader2 } from "lucide-react";

export default function HomePage() {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (isAuthenticated) {
        router.push("/dashboard");
      } else {
        router.push("/login");
      }
    }
  }, [isAuthenticated, loading, router]);

  return (
    <div className="min-h-screen bg-background">
      <LoadingState icon={<Loader2 aria-hidden="true" />} message="Cargando…" />
    </div>
  );
}

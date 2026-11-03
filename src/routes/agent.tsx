import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/agent")({
  head: () => ({
    meta: [
      { title: "Sorat — Agent Counter POS Booking App" },
      { name: "description", content: "Mobile Counter POS App for Agent Booking & Thermal Printing" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" },
    ],
  }),
  component: AgentRedirect,
});

function AgentRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/", replace: true });
  }, [navigate]);

  return null;
}

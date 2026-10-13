import concepts from "@/content/learn-together/meta/concepts.json";

const map = concepts as Record<string, { label: string; icon: string }>;
export const conceptLabel = (tag: string) => map[tag]?.label || tag.replace(/[_-]/g, " ");
export const conceptIcon = (tag: string) => map[tag]?.icon || "✨";

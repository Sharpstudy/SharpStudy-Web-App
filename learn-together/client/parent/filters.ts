// Pure Explore filtering (no React), shared by the page and tests.
export interface ActivitySummary {
  activityId: string;
  slug: string;
  tier: "free" | "paid";
  title: string;
  subject: "math" | "science";
  activityType: string;
  ageBands: string[];
  estimatedMinutes: number;
  learningGoal: string;
  conceptTags: string[];
  realWorldHook: string;
  materialsNeed: "household" | "kit_optional" | "none";
  lowMess: boolean;
  setting: "indoor" | "outdoor" | "either";
  hasOptionalKit: boolean;
  entitled: boolean;
  saved: boolean;
  dismissed: boolean;
}

export interface Filters {
  subject: "" | "math" | "science";
  maxMinutes: 0 | 10 | 15;
  materials: "" | "household" | "kit" | "none";
  activityType: string;
  lowMess: boolean;
  setting: "" | "indoor" | "outdoor";
  showDismissed: boolean;
  savedOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = { subject: "", maxMinutes: 0, materials: "", activityType: "", lowMess: false, setting: "", showDismissed: false, savedOnly: false };

/** Pure filter used by the page and by tests: every active filter must match. */
export function applyFilters(list: ActivitySummary[], f: Filters) {
  return list.filter(
    (a) =>
      (!f.subject || a.subject === f.subject) &&
      (!f.maxMinutes || a.estimatedMinutes <= f.maxMinutes) &&
      (!f.materials || (f.materials === "none" ? a.materialsNeed === "none" : f.materials === "kit" ? a.hasOptionalKit : a.materialsNeed !== "none")) &&
      (!f.activityType || a.activityType === f.activityType) &&
      (!f.lowMess || a.lowMess) &&
      (!f.setting || a.setting === f.setting || a.setting === "either") &&
      (f.showDismissed || !a.dismissed) &&
      (!f.savedOnly || a.saved)
  );
}


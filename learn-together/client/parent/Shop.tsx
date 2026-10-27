import React, { useEffect, useState } from "react";
import { parentApi } from "../api";
import { ErrorNote, LearnShell, Loading, s } from "../ui";

interface ShopItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  imageKey: string | null;
  priceCents: number;
}

const CATEGORIES = ["all", "math", "reading", "science", "arts", "other"];
const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  math: "Math",
  reading: "Reading",
  science: "Science",
  arts: "Arts",
  other: "Other",
};

const ITEM_ICONS: Record<string, string> = {
  math: "📐",
  reading: "📚",
  science: "🔬",
  arts: "🎨",
  other: "🎁",
};

// Seed items shown when DB is empty (demo mode)
const DEMO_ITEMS: ShopItem[] = [
  { id: "demo-1", name: "Measurement Kit", description: "Rulers, measuring tape, and activity cards for hands-on measurement.", category: "math", imageKey: null, priceCents: 499 },
  { id: "demo-2", name: "Alphabet Set", description: "Tactile letter cards for reading and phonics practice.", category: "reading", imageKey: null, priceCents: 399 },
  { id: "demo-3", name: "Times Table Poster", description: "Full-colour wall poster with visual multiplication grid.", category: "math", imageKey: null, priceCents: 299 },
  { id: "demo-4", name: "Fraction Tiles", description: "Hands-on fraction manipulatives for visual learning.", category: "math", imageKey: null, priceCents: 599 },
  { id: "demo-5", name: "Science Lab Kit", description: "Simple at-home experiments with everyday materials.", category: "science", imageKey: null, priceCents: 799 },
  { id: "demo-6", name: "Story Starter Cards", description: "Illustrated prompts to inspire creative writing.", category: "reading", imageKey: null, priceCents: 349 },
];

export default function Shop({ user }: { user: unknown }) {
  const [category, setCategory] = useState("all");
  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [cart, setCart] = useState<string[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const [bought, setBought] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    parentApi
      .get<ShopItem[]>(`/api/learn/shop/items?category=${category}`)
      .then((data) => setItems(data.length ? data : DEMO_ITEMS.filter((i) => category === "all" || i.category === category)))
      .catch(() => setItems(DEMO_ITEMS.filter((i) => category === "all" || i.category === category)))
      .finally(() => setLoading(false));
  }, [category]);

  const addToCart = (id: string) => {
    setCart((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const purchase = async (item: ShopItem) => {
    if (item.id.startsWith("demo-")) {
      addToCart(item.id);
      setBought((b) => new Set([...b, item.id]));
      return;
    }
    setBuying(item.id);
    try {
      await parentApi.post("/api/learn/shop/purchase", { itemId: item.id });
      setBought((b) => new Set([...b, item.id]));
      addToCart(item.id);
    } catch (e) {
      setErr(e);
    } finally {
      setBuying(null);
    }
  };

  const fmtPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <LearnShell user={user} title="Shop">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Learn-Together Shop</h1>
          <p className={s.muted}>Physical and digital resources to support your lessons at home.</p>
        </div>
        {cart.length > 0 && (
          <button className={s.btn}>
            Cart ({cart.length})
          </button>
        )}
      </div>

      <ErrorNote error={err} />

      <div className={s.shopLayout}>
        <aside className={s.shopSidebar}>
          <h3>Category</h3>
          <div className={s.shopFilter}>
            {CATEGORIES.map((c) => (
              <button key={c} className={category === c ? s.active : ""} onClick={() => setCategory(c)}>
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </aside>

        <div>
          {loading ? (
            <Loading />
          ) : items.length === 0 ? (
            <p className={s.muted}>No items in this category yet.</p>
          ) : (
            <div className={s.shopGrid}>
              {items.map((item) => (
                <div key={item.id} className={s.shopCard}>
                  <div className={s.shopCardThumb}>
                    <span style={{ fontSize: 48 }}>{ITEM_ICONS[item.category] || "🎁"}</span>
                    <span className={s.previewBadge}>PREVIEW</span>
                  </div>
                  <div className={s.shopCardBody}>
                    <h4>{item.name}</h4>
                    <p>{item.description || ""}</p>
                  </div>
                  <div className={s.shopCardFooter}>
                    <span className={s.price}>{fmtPrice(item.priceCents)}</span>
                    <button
                      className={bought.has(item.id) ? s.btnGhost : s.btn}
                      style={{ fontSize: 14, padding: "8px 16px", minHeight: 36 }}
                      disabled={buying === item.id || bought.has(item.id)}
                      onClick={() => purchase(item)}
                    >
                      {bought.has(item.id) ? "Added ✓" : buying === item.id ? "…" : "Add to cart"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </LearnShell>
  );
}

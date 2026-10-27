"use strict";
// Learn Together UX: new tables for weekly plans, shop, coaching, subscriptions, badges, reflections, review garden.
// All tables prefixed lt_. Additive only — does not alter existing tables.

const TABLES_IN_DROP_ORDER = [
  "lt_family_badges",
  "lt_child_reflections",
  "lt_review_garden_items",
  "lt_coach_bookings",
  "lt_shop_purchases",
  "lt_subscriptions",
  "lt_coaches",
  "lt_shop_items",
  "lt_weekly_plans",
  "lt_family_values",
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const id = { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true };
    const ts = {
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    };
    const create = (name, cols) => queryInterface.createTable(name, cols);
    const index = (table, fields, opts = {}) => queryInterface.addIndex(table, fields, opts);

    // ---------- Family values (blueprint) ----------
    await create("lt_family_values", {
      id,
      family_id: { type: Sequelize.UUID, allowNull: false },
      value_category: {
        type: Sequelize.ENUM(
          "academics", "perseverance", "honesty", "creativity", "responsibility",
          "healthy", "service", "faith", "kindness", "curiosity", "gratitude",
          "respect", "courage", "empathy", "integrity", "self_control", "teamwork",
          "leadership", "generosity", "humility", "patience", "diligence", "joy",
          "peace", "love", "forgiveness", "fairness", "wisdom", "stewardship", "excellence"
        ),
        allowNull: false,
      },
      importance: { type: Sequelize.TINYINT, allowNull: false },
      ...ts,
    });
    await index("lt_family_values", ["family_id"]);
    await index("lt_family_values", ["family_id", "value_category"], { unique: true });

    // ---------- Weekly plans ----------
    await create("lt_weekly_plans", {
      id,
      family_id: { type: Sequelize.UUID, allowNull: false },
      child_profile_id: { type: Sequelize.UUID, allowNull: false },
      week_start: { type: Sequelize.DATEONLY, allowNull: false },
      subject: { type: Sequelize.STRING(40), allowNull: false },
      day_of_week: { type: Sequelize.TINYINT, allowNull: false },
      lesson_slug: { type: Sequelize.STRING(80), allowNull: true },
      position: { type: Sequelize.TINYINT, allowNull: false, defaultValue: 0 },
      completed_at: { type: Sequelize.DATEONLY, allowNull: true },
      ...ts,
    });
    await index("lt_weekly_plans", ["family_id", "child_profile_id", "week_start"]);

    // ---------- Shop items ----------
    await create("lt_shop_items", {
      id,
      name: { type: Sequelize.STRING(120), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      category: {
        type: Sequelize.ENUM("math", "reading", "science", "arts", "other"),
        allowNull: false,
        defaultValue: "other",
      },
      image_key: { type: Sequelize.STRING(80), allowNull: true },
      price_cents: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      stripe_product_id: { type: Sequelize.STRING(80), allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...ts,
    });
    await index("lt_shop_items", ["category"]);
    await index("lt_shop_items", ["active"]);

    // ---------- Shop purchases ----------
    await create("lt_shop_purchases", {
      id,
      family_id: { type: Sequelize.UUID, allowNull: false },
      user_id: { type: Sequelize.UUID, allowNull: false },
      shop_item_id: { type: Sequelize.UUID, allowNull: false },
      price_paid_cents: { type: Sequelize.INTEGER, allowNull: false },
      stripe_payment_intent_id: { type: Sequelize.STRING(120), allowNull: true },
      purchased_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      ...ts,
    });
    await index("lt_shop_purchases", ["family_id"]);
    await index("lt_shop_purchases", ["shop_item_id"]);

    // ---------- Subscriptions ----------
    await create("lt_subscriptions", {
      id,
      family_id: { type: Sequelize.UUID, allowNull: false, unique: true },
      plan: {
        type: Sequelize.ENUM("free", "family", "family_pro"),
        allowNull: false,
        defaultValue: "free",
      },
      stripe_subscription_id: { type: Sequelize.STRING(120), allowNull: true },
      stripe_customer_id: { type: Sequelize.STRING(120), allowNull: true },
      current_period_end: { type: Sequelize.DATE, allowNull: true },
      canceled_at: { type: Sequelize.DATE, allowNull: true },
      ...ts,
    });
    await index("lt_subscriptions", ["family_id"], { unique: true });

    // ---------- Coaches ----------
    await create("lt_coaches", {
      id,
      user_id: { type: Sequelize.UUID, allowNull: false },
      bio: { type: Sequelize.TEXT, allowNull: true },
      subjects: { type: Sequelize.JSON, allowNull: true },
      hourly_rate_cents: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      rating: { type: Sequelize.DECIMAL(3, 2), allowNull: true },
      review_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      ...ts,
    });
    await index("lt_coaches", ["active"]);
    await index("lt_coaches", ["user_id"]);

    // ---------- Coach bookings ----------
    await create("lt_coach_bookings", {
      id,
      coach_id: { type: Sequelize.UUID, allowNull: false },
      family_id: { type: Sequelize.UUID, allowNull: false },
      booked_by_user_id: { type: Sequelize.UUID, allowNull: false },
      scheduled_at: { type: Sequelize.DATE, allowNull: false },
      duration_minutes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 60 },
      status: {
        type: Sequelize.ENUM("pending", "confirmed", "completed", "cancelled"),
        allowNull: false,
        defaultValue: "pending",
      },
      stripe_payment_intent_id: { type: Sequelize.STRING(120), allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      ...ts,
    });
    await index("lt_coach_bookings", ["coach_id", "scheduled_at"]);
    await index("lt_coach_bookings", ["family_id"]);

    // ---------- Child reflections ----------
    await create("lt_child_reflections", {
      id,
      child_profile_id: { type: Sequelize.UUID, allowNull: false },
      session_id: { type: Sequelize.UUID, allowNull: true },
      text: { type: Sequelize.TEXT, allowNull: false },
      mood: {
        type: Sequelize.ENUM("great", "good", "okay", "hard"),
        allowNull: false,
        defaultValue: "good",
      },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await index("lt_child_reflections", ["child_profile_id", "created_at"]);

    // ---------- Review garden items ----------
    await create("lt_review_garden_items", {
      id,
      child_profile_id: { type: Sequelize.UUID, allowNull: false },
      concept_tag: { type: Sequelize.STRING(80), allowNull: false },
      activity_slug: { type: Sequelize.STRING(80), allowNull: true },
      next_review_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      interval: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      ease_factor: { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 2.5 },
      repetitions: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      ...ts,
    });
    await index("lt_review_garden_items", ["child_profile_id", "next_review_at"]);

    // ---------- Family badges ----------
    await create("lt_family_badges", {
      id,
      family_id: { type: Sequelize.UUID, allowNull: false },
      child_profile_id: { type: Sequelize.UUID, allowNull: true },
      badge_key: { type: Sequelize.STRING(60), allowNull: false },
      earned_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      metadata: { type: Sequelize.JSON, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await index("lt_family_badges", ["family_id"]);
    await index("lt_family_badges", ["child_profile_id"]);
  },

  async down(queryInterface) {
    for (const table of TABLES_IN_DROP_ORDER) {
      await queryInterface.dropTable(table);
    }
  },
};

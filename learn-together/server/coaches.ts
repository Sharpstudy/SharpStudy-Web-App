import { Op } from "sequelize";
import User from "@/database/models/user";
import { Coach, CoachBooking } from "./models";

export interface CoachRow {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  bio: string | null;
  subjects: string[];
  hourlyRateCents: number;
  rating: number | null;
  reviewCount: number;
}

export interface BookingRow {
  id: string;
  coachId: string;
  familyId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  notes: string | null;
}

export async function listCoaches(): Promise<CoachRow[]> {
  const coaches = await Coach.findAll({ where: { active: true }, order: [["review_count", "DESC"]] });
  const userIds = coaches.map((c) => c.userId);
  const users = userIds.length
    ? await (User as any).findAll({ where: { id: userIds } })
    : [];
  const userMap = new Map(users.map((u: any) => [u.id, u]));
  return coaches.map((c) => {
    const u: any = userMap.get(c.userId) || {};
    return {
      id: c.id,
      userId: c.userId,
      firstName: u.firstName || u.first_name || "",
      lastName: u.lastName || u.last_name || "",
      bio: c.bio || null,
      subjects: Array.isArray(c.subjects) ? c.subjects : [],
      hourlyRateCents: c.hourlyRateCents || 0,
      rating: c.rating ? parseFloat(String(c.rating)) : null,
      reviewCount: c.reviewCount || 0,
    };
  });
}

export async function bookCoach(
  coachId: string,
  familyId: string,
  bookedByUserId: string,
  scheduledAt: Date,
  durationMinutes: number,
  notes?: string
): Promise<BookingRow> {
  const row = await CoachBooking.create({
    coachId,
    familyId,
    bookedByUserId,
    scheduledAt,
    durationMinutes,
    status: "pending",
    notes: notes || null,
  });
  return {
    id: row.id,
    coachId: row.coachId,
    familyId: row.familyId,
    scheduledAt: row.scheduledAt.toISOString(),
    durationMinutes: row.durationMinutes,
    status: row.status,
    notes: row.notes || null,
  };
}

export async function getCoachBookings(coachId: string): Promise<BookingRow[]> {
  const rows = await CoachBooking.findAll({
    where: {
      coachId,
      scheduledAt: { [Op.gte]: new Date() },
      status: { [Op.in]: ["pending", "confirmed"] },
    },
    order: [["scheduled_at", "ASC"]],
  });
  return rows.map((r) => ({
    id: r.id,
    coachId: r.coachId,
    familyId: r.familyId,
    scheduledAt: r.scheduledAt.toISOString(),
    durationMinutes: r.durationMinutes,
    status: r.status,
    notes: r.notes || null,
  }));
}

export async function getTutorSessions(userId: string): Promise<BookingRow[]> {
  const coach = await Coach.findOne({ where: { userId, active: true } });
  if (!coach) return [];
  return getCoachBookings(coach.id);
}

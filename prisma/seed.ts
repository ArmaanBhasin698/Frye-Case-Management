/**
 * Seed data for local development only.
 *
 * Everything here is fictional (see CLAUDE.md, section 2 and
 * docs/SECURITY.md) — no real client, matter, or case data. Names, case
 * numbers, courts, and phone numbers are all made up.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Idempotent: wipe and reseed, in dependency order.
  await prisma.auditEvent.deleteMany();
  await prisma.call.deleteMany();
  await prisma.document.deleteMany();
  await prisma.discoveryFile.deleteMany();
  await prisma.discoveryProduction.deleteMany();
  await prisma.deadline.deleteMany();
  await prisma.task.deleteMany();
  await prisma.note.deleteMany();
  await prisma.matterAssignment.deleteMany();
  await prisma.matter.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  // --- Staff -----------------------------------------------------------
  // passwordHash is a placeholder — Auth.js login isn't implemented yet
  // (see docs/ROADMAP.md, Phase 1). Never a real credential.
  const sarah = await prisma.user.create({
    data: {
      name: "Sarah Whitfield",
      email: "sarah.whitfield@fryelawgroup.example",
      passwordHash: "not-implemented",
      role: "ATTORNEY",
    },
  });

  const marcus = await prisma.user.create({
    data: {
      name: "Marcus Odom",
      email: "marcus.odom@fryelawgroup.example",
      passwordHash: "not-implemented",
      role: "ATTORNEY",
    },
  });

  const priya = await prisma.user.create({
    data: {
      name: "Priya Nair",
      email: "priya.nair@fryelawgroup.example",
      passwordHash: "not-implemented",
      role: "PARALEGAL",
    },
  });

  // --- Clients -----------------------------------------------------------
  const jordan = await prisma.client.create({
    data: {
      firstName: "Jordan",
      lastName: "Ellis",
      email: "jordan.ellis@example.com",
      phone: "555-0142",
    },
  });

  const maria = await prisma.client.create({
    data: {
      firstName: "Maria",
      lastName: "Alvarez",
      email: "maria.alvarez@example.com",
      phone: "555-0198",
    },
  });

  const devon = await prisma.client.create({
    data: {
      firstName: "Devon",
      lastName: "Marsh",
      email: "devon.marsh@example.com",
      phone: "555-0173",
    },
  });

  // --- Matters -------------------------------------------------------------
  const ellisMatter = await prisma.matter.create({
    data: {
      clientId: jordan.id,
      caseNumber: "24-CR-04821",
      court: "Fulton County Superior Court (fictional)",
      charges: "Possession of a Controlled Substance",
      status: "OPEN",
      openedDate: new Date("2024-11-04"),
    },
  });

  const alvarezMatter = await prisma.matter.create({
    data: {
      clientId: maria.id,
      caseNumber: "24-CR-03190",
      court: "Cobb County State Court (fictional)",
      charges: "Driving Under the Influence",
      status: "OPEN",
      openedDate: new Date("2025-01-17"),
    },
  });

  const marshMatter = await prisma.matter.create({
    data: {
      clientId: devon.id,
      caseNumber: "23-CR-09765",
      court: "DeKalb County Superior Court (fictional)",
      charges: "Aggravated Assault",
      status: "CLOSED",
      openedDate: new Date("2023-06-22"),
      closedDate: new Date("2025-02-10"),
    },
  });

  // --- Assignments -----------------------------------------------------
  await prisma.matterAssignment.createMany({
    data: [
      { matterId: ellisMatter.id, userId: sarah.id, role: "LEAD_ATTORNEY" },
      { matterId: ellisMatter.id, userId: priya.id, role: "PARALEGAL" },
      { matterId: alvarezMatter.id, userId: sarah.id, role: "LEAD_ATTORNEY" },
      { matterId: alvarezMatter.id, userId: priya.id, role: "PARALEGAL" },
      { matterId: marshMatter.id, userId: marcus.id, role: "LEAD_ATTORNEY" },
      { matterId: marshMatter.id, userId: priya.id, role: "PARALEGAL" },
    ],
  });

  // --- Notes -------------------------------------------------------------
  await prisma.note.createMany({
    data: [
      {
        matterId: ellisMatter.id,
        authorId: sarah.id,
        body: "Initial client interview completed. Client maintains the substance was not his; vehicle was borrowed. Follow up on chain of custody for the traffic stop.",
        pinned: true,
      },
      {
        matterId: ellisMatter.id,
        authorId: priya.id,
        body: "Requested bodycam footage from arresting agency. Awaiting response.",
      },
      {
        matterId: alvarezMatter.id,
        authorId: sarah.id,
        body: "Reviewed breathalyzer calibration records — calibration log looks incomplete for the relevant month. Worth challenging.",
        pinned: true,
      },
      {
        matterId: marshMatter.id,
        authorId: marcus.id,
        body: "Case resolved via negotiated plea. Client sentenced to probation; file closed pending final paperwork.",
      },
    ],
  });

  // --- Tasks ---------------------------------------------------------------
  await prisma.task.createMany({
    data: [
      {
        matterId: ellisMatter.id,
        assignedToId: priya.id,
        title: "Request bodycam and dashcam footage",
        description: "Formal request to arresting agency for all footage from the traffic stop.",
        dueDate: new Date("2026-08-15"),
        status: "IN_PROGRESS",
        priority: "HIGH",
      },
      {
        matterId: ellisMatter.id,
        assignedToId: sarah.id,
        title: "Draft motion to suppress",
        dueDate: new Date("2026-09-02"),
        status: "OPEN",
        priority: "HIGH",
      },
      {
        matterId: alvarezMatter.id,
        assignedToId: priya.id,
        title: "Subpoena breathalyzer maintenance records",
        dueDate: new Date("2026-08-20"),
        status: "OPEN",
        priority: "NORMAL",
      },
      {
        matterId: alvarezMatter.id,
        assignedToId: sarah.id,
        title: "Prep client for arraignment",
        dueDate: new Date("2026-08-12"),
        status: "OPEN",
        priority: "NORMAL",
      },
      {
        matterId: marshMatter.id,
        assignedToId: marcus.id,
        title: "File closing paperwork with the court",
        status: "DONE",
        priority: "LOW",
      },
    ],
  });

  // --- Deadlines -------------------------------------------------------
  await prisma.deadline.createMany({
    data: [
      {
        matterId: ellisMatter.id,
        type: "SPEEDY_TRIAL",
        date: new Date("2026-11-04"),
        description: "Speedy trial deadline",
        reminderDaysBefore: 30,
      },
      {
        matterId: ellisMatter.id,
        type: "FILING",
        date: new Date("2026-09-05"),
        description: "Deadline to file pretrial motions",
        reminderDaysBefore: 10,
      },
      {
        matterId: alvarezMatter.id,
        type: "FILING",
        date: new Date("2026-08-25"),
        description: "Deadline to file motion challenging breathalyzer evidence",
        reminderDaysBefore: 7,
      },
      {
        matterId: marshMatter.id,
        type: "OTHER",
        date: new Date("2025-03-01"),
        description: "Final compliance check-in with probation (informational, matter closed)",
        satisfied: true,
        satisfiedAt: new Date("2025-03-01"),
      },
    ],
  });

  // --- Discovery (structure only — no Bates numbering logic yet) -------
  const ellisProduction = await prisma.discoveryProduction.create({
    data: {
      matterId: ellisMatter.id,
      label: "Initial Production",
      source: "County Sheriff's Office (fictional)",
      receivedDate: new Date("2024-11-20"),
      batesPrefix: "ELLIS",
      batesStart: 1,
      batesEnd: 84,
    },
  });

  await prisma.discoveryFile.createMany({
    data: [
      {
        productionId: ellisProduction.id,
        originalFilename: "incident-report.pdf",
        identifier: "ELLIS000001",
        fileType: "PDF",
        pageCount: 12,
        dropboxPathOriginal:
          "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 1/Originals/incident-report.pdf",
      },
      {
        productionId: ellisProduction.id,
        originalFilename: "bodycam-officer-reyes.mp4",
        identifier: "ELLIS-V001",
        fileType: "VIDEO",
        dropboxPathOriginal:
          "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 1/Originals/bodycam-officer-reyes.mp4",
      },
      {
        productionId: ellisProduction.id,
        originalFilename: "lab-report.pdf",
        identifier: "ELLIS000013",
        fileType: "PDF",
        pageCount: 4,
        dropboxPathOriginal:
          "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 1/Originals/lab-report.pdf",
      },
    ],
  });

  const alvarezProduction = await prisma.discoveryProduction.create({
    data: {
      matterId: alvarezMatter.id,
      label: "Initial Production",
      source: "Municipal Police Department (fictional)",
      receivedDate: new Date("2025-01-30"),
      batesPrefix: "ALVAREZ",
      batesStart: 1,
      batesEnd: 41,
    },
  });

  await prisma.discoveryFile.createMany({
    data: [
      {
        productionId: alvarezProduction.id,
        originalFilename: "arrest-report.pdf",
        identifier: "ALVAREZ000001",
        fileType: "PDF",
        pageCount: 6,
        dropboxPathOriginal:
          "/Frye Law Group/Clients/Alvarez, Maria/24-CR-03190/Discovery/Production 1/Originals/arrest-report.pdf",
      },
      {
        productionId: alvarezProduction.id,
        originalFilename: "dashcam.mp4",
        identifier: "ALVAREZ-V001",
        fileType: "VIDEO",
        dropboxPathOriginal:
          "/Frye Law Group/Clients/Alvarez, Maria/24-CR-03190/Discovery/Production 1/Originals/dashcam.mp4",
      },
    ],
  });

  // --- General documents -------------------------------------------------
  await prisma.document.createMany({
    data: [
      {
        matterId: ellisMatter.id,
        category: "PLEADING",
        title: "Entry of Appearance",
        dropboxPath: "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Pleadings/entry-of-appearance.pdf",
        uploadedById: priya.id,
      },
      {
        matterId: ellisMatter.id,
        category: "CORRESPONDENCE",
        title: "Letter to prosecutor re: discovery request",
        dropboxPath: "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Correspondence/2024-11-22-letter-to-da.pdf",
        uploadedById: sarah.id,
      },
      {
        matterId: alvarezMatter.id,
        category: "PLEADING",
        title: "Entry of Appearance",
        dropboxPath: "/Frye Law Group/Clients/Alvarez, Maria/24-CR-03190/Pleadings/entry-of-appearance.pdf",
        uploadedById: priya.id,
      },
      {
        matterId: marshMatter.id,
        category: "PLEADING",
        title: "Final Disposition Order",
        dropboxPath: "/Frye Law Group/Clients/Marsh, Devon/23-CR-09765/Pleadings/final-disposition-order.pdf",
        uploadedById: marcus.id,
      },
    ],
  });

  // --- Calls (manually logged — no Vonage integration yet) ---------------
  await prisma.call.createMany({
    data: [
      {
        matterId: ellisMatter.id,
        contactName: "Jordan Ellis",
        direction: "OUTBOUND",
        fromNumber: "555-0100",
        toNumber: "555-0142",
        occurredAt: new Date("2026-07-28T15:30:00Z"),
        durationSeconds: 420,
        flagged: false,
        notes: "Update on discovery request status.",
        filedById: priya.id,
        filedAt: new Date("2026-07-28T15:45:00Z"),
      },
      {
        matterId: ellisMatter.id,
        contactName: "County Sheriff's Records Office (fictional)",
        direction: "INBOUND",
        fromNumber: "555-0250",
        toNumber: "555-0100",
        occurredAt: new Date("2026-08-01T10:05:00Z"),
        durationSeconds: 180,
        flagged: true,
        notes: "Confirmed bodycam footage will be released within 10 business days.",
      },
      {
        matterId: alvarezMatter.id,
        contactName: "Maria Alvarez",
        direction: "OUTBOUND",
        fromNumber: "555-0100",
        toNumber: "555-0198",
        occurredAt: new Date("2026-08-03T13:15:00Z"),
        durationSeconds: 300,
        flagged: false,
        notes: "Reviewed arraignment prep.",
        filedById: sarah.id,
        filedAt: new Date("2026-08-03T13:20:00Z"),
      },
      {
        matterId: null,
        contactName: "Unknown caller",
        direction: "INBOUND",
        fromNumber: "555-0399",
        toNumber: "555-0100",
        occurredAt: new Date("2026-08-06T09:00:00Z"),
        durationSeconds: 45,
        flagged: true,
        notes: "Missed context — needs to be reviewed and filed to a matter, or discarded.",
      },
    ],
  });

  // --- Audit events (demonstrates the Timeline tab; not yet produced by ---
  // --- real Server Actions since no write UI exists in this slice) -------
  await prisma.auditEvent.createMany({
    data: [
      {
        actorId: sarah.id,
        action: "CREATE",
        entityType: "Matter",
        entityId: ellisMatter.id,
        matterId: ellisMatter.id,
        occurredAt: new Date("2024-11-04T09:00:00Z"),
        metadata: { caseNumber: ellisMatter.caseNumber },
      },
      {
        actorId: priya.id,
        action: "CREATE",
        entityType: "Note",
        entityId: ellisMatter.id,
        matterId: ellisMatter.id,
        occurredAt: new Date("2024-11-06T14:00:00Z"),
      },
      {
        actorId: priya.id,
        action: "CREATE",
        entityType: "DiscoveryProduction",
        entityId: ellisProduction.id,
        matterId: ellisMatter.id,
        occurredAt: new Date("2024-11-20T11:00:00Z"),
        metadata: { label: ellisProduction.label },
      },
      {
        actorId: sarah.id,
        action: "CREATE",
        entityType: "Matter",
        entityId: alvarezMatter.id,
        matterId: alvarezMatter.id,
        occurredAt: new Date("2025-01-17T09:00:00Z"),
        metadata: { caseNumber: alvarezMatter.caseNumber },
      },
      {
        actorId: marcus.id,
        action: "UPDATE",
        entityType: "Matter",
        entityId: marshMatter.id,
        matterId: marshMatter.id,
        occurredAt: new Date("2025-02-10T16:00:00Z"),
        metadata: { status: "CLOSED" },
      },
    ],
  });

  console.log("Seed complete:");
  console.log(`  Users: ${await prisma.user.count()}`);
  console.log(`  Clients: ${await prisma.client.count()}`);
  console.log(`  Matters: ${await prisma.matter.count()}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Seed data for local development / demo purposes only.
 *
 * Everything here is fictional (see CLAUDE.md, section 2 and
 * docs/SECURITY.md) — no real client, matter, or case data. Names, case
 * numbers, courts, and phone numbers are all made up. The discovery
 * productions/files/comparison below are hand-authored to look like a
 * plausible result, from before the real Bates/hashing/comparison engine
 * existed (see lib/discovery/ and docs/ROADMAP.md) — they carry no stored
 * file content, so there's nothing to download or re-compare for them.
 * Anything created through the Discovery tab's UI goes through the real
 * engine instead.
 *
 * All seeded users share one password so a demo doesn't require memorizing
 * five of them. This is a development-only convenience — see
 * docs/SECURITY.md for why it must never happen anywhere near production.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** Fictional dev-only password shared by every seeded user. See README for the login table. */
const DEV_PASSWORD = "FryeDemo!2026";

async function main() {
  const devPasswordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  // Idempotent: wipe and reseed, in dependency order.
  await prisma.discoveryFileMatch.deleteMany();
  await prisma.discoveryComparison.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.call.deleteMany();
  await prisma.document.deleteMany();
  await prisma.discoveryFile.deleteMany();
  await prisma.discoveryProduction.deleteMany();
  await prisma.calendarEvent.deleteMany();
  await prisma.deadline.deleteMany();
  await prisma.task.deleteMany();
  await prisma.note.deleteMany();
  await prisma.matterAssignment.deleteMany();
  await prisma.matter.deleteMany();
  await prisma.client.deleteMany();
  await prisma.user.deleteMany();

  // --- Staff -----------------------------------------------------------
  // Every account below logs in with DEV_PASSWORD (see top of file and
  // README's "Demo login credentials" table). Fictional people, fictional
  // firm — never real credentials.
  // Admin: intentionally not captured or assigned to any matter below —
  // the ADMIN role bypasses MatterAssignment checks entirely (see
  // lib/auth/authorization.ts), so this account should see all four
  // matters despite having zero assignment rows.
  await prisma.user.create({
    data: {
      name: "Alex Rivera",
      email: "alex.rivera@fryelawgroup.example",
      passwordHash: devPasswordHash,
      role: "ADMIN",
    },
  });

  const sarah = await prisma.user.create({
    data: {
      name: "Sarah Whitfield",
      email: "sarah.whitfield@fryelawgroup.example",
      passwordHash: devPasswordHash,
      role: "ATTORNEY",
    },
  });

  const marcus = await prisma.user.create({
    data: {
      name: "Marcus Odom",
      email: "marcus.odom@fryelawgroup.example",
      passwordHash: devPasswordHash,
      role: "ATTORNEY",
    },
  });

  const priya = await prisma.user.create({
    data: {
      name: "Priya Nair",
      email: "priya.nair@fryelawgroup.example",
      passwordHash: devPasswordHash,
      role: "PARALEGAL",
    },
  });

  const taylor = await prisma.user.create({
    data: {
      name: "Taylor Brooks",
      email: "taylor.brooks@fryelawgroup.example",
      passwordHash: devPasswordHash,
      role: "STAFF",
    },
  });

  // --- Clients -----------------------------------------------------------
  const jordan = await prisma.client.create({
    data: { firstName: "Jordan", lastName: "Ellis", email: "jordan.ellis@example.com", phone: "555-0142" },
  });

  const maria = await prisma.client.create({
    data: { firstName: "Maria", lastName: "Alvarez", email: "maria.alvarez@example.com", phone: "555-0198" },
  });

  const devon = await prisma.client.create({
    data: { firstName: "Devon", lastName: "Marsh", email: "devon.marsh@example.com", phone: "555-0173" },
  });

  const amara = await prisma.client.create({
    data: { firstName: "Amara", lastName: "Patel", email: "amara.patel@example.com", phone: "555-0211" },
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

  const patelMatter = await prisma.matter.create({
    data: {
      clientId: amara.id,
      caseNumber: "25-CR-01044",
      court: "Fulton County Superior Court (fictional)",
      charges: "Burglary",
      status: "PENDING",
      openedDate: new Date("2026-07-20"),
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
      { matterId: patelMatter.id, userId: marcus.id, role: "LEAD_ATTORNEY" },
      { matterId: patelMatter.id, userId: priya.id, role: "PARALEGAL" },
      // Taylor Brooks (STAFF) is deliberately assigned to exactly one
      // matter, unlike everyone else — logging in as Taylor is the
      // clearest way to demonstrate that non-admins only see what
      // they're assigned to (see README's demo credentials table).
      { matterId: patelMatter.id, userId: taylor.id, role: "STAFF" },
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
        matterId: ellisMatter.id,
        authorId: sarah.id,
        body: "Amended lab report received in supplemental production — testing conclusion changed from initial report. Flagging for expert review.",
        pinned: true,
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
      {
        matterId: patelMatter.id,
        authorId: marcus.id,
        body: "New matter — retained yesterday. Arraignment scheduled; awaiting initial discovery from the DA's office.",
        pinned: true,
      },
    ],
  });

  // --- Tasks ---------------------------------------------------------------
  await prisma.task.createMany({
    data: [
      // Ellis — deliberately spread across every status for the Kanban demo.
      {
        matterId: ellisMatter.id,
        assignedToId: sarah.id,
        title: "Client intake interview",
        description: "Initial interview to establish timeline and identify witnesses.",
        status: "DONE",
        priority: "NORMAL",
      },
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
        title: "Review amended lab report for chain-of-custody issues",
        description: "Compare against original lab report from initial production.",
        dueDate: new Date("2026-08-18"),
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
        matterId: ellisMatter.id,
        assignedToId: priya.id,
        title: "Prepare cross-examination outline for Officer Reyes",
        dueDate: new Date("2026-09-08"),
        status: "OPEN",
        priority: "NORMAL",
      },
      {
        matterId: ellisMatter.id,
        assignedToId: priya.id,
        title: "Subpoena original lab analyst",
        description: "Case was reassigned within the lab; no longer needed.",
        status: "CANCELLED",
        priority: "LOW",
      },

      // Alvarez
      {
        matterId: alvarezMatter.id,
        assignedToId: priya.id,
        title: "Obtain certified driving record",
        status: "DONE",
        priority: "NORMAL",
      },
      {
        matterId: alvarezMatter.id,
        assignedToId: sarah.id,
        title: "Negotiate plea offer with ADA",
        dueDate: new Date("2026-08-22"),
        status: "IN_PROGRESS",
        priority: "NORMAL",
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

      // Marsh (closed)
      {
        matterId: marshMatter.id,
        assignedToId: marcus.id,
        title: "File closing paperwork with the court",
        status: "DONE",
        priority: "LOW",
      },

      // Patel (new matter)
      {
        matterId: patelMatter.id,
        assignedToId: priya.id,
        title: "File entry of appearance",
        dueDate: new Date("2026-08-14"),
        status: "OPEN",
        priority: "HIGH",
      },
      {
        matterId: patelMatter.id,
        assignedToId: priya.id,
        title: "Schedule initial client meeting",
        dueDate: new Date("2026-08-13"),
        status: "OPEN",
        priority: "NORMAL",
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
        matterId: patelMatter.id,
        type: "FILING",
        date: new Date("2026-08-14"),
        description: "Deadline to file entry of appearance",
        reminderDaysBefore: 3,
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

  // --- Calendar events (court dates, meetings) --------------------------
  await prisma.calendarEvent.createMany({
    data: [
      {
        matterId: ellisMatter.id,
        title: "Pretrial Conference",
        type: "HEARING",
        startTime: new Date("2026-08-19T14:00:00Z"),
        endTime: new Date("2026-08-19T14:30:00Z"),
        location: "Fulton County Superior Court, Courtroom 4B",
      },
      {
        matterId: ellisMatter.id,
        title: "Suppression Hearing",
        type: "HEARING",
        startTime: new Date("2026-09-25T15:00:00Z"),
        location: "Fulton County Superior Court, Courtroom 4B",
      },
      {
        matterId: alvarezMatter.id,
        title: "Arraignment",
        type: "HEARING",
        startTime: new Date("2026-08-18T13:30:00Z"),
        location: "Cobb County State Court, Courtroom 2",
      },
      {
        matterId: alvarezMatter.id,
        title: "Trial",
        type: "HEARING",
        startTime: new Date("2026-10-05T09:00:00Z"),
        location: "Cobb County State Court, Courtroom 2",
      },
      {
        matterId: patelMatter.id,
        title: "Arraignment",
        type: "HEARING",
        startTime: new Date("2026-08-22T13:00:00Z"),
        location: "Fulton County Superior Court, Courtroom 6",
      },
      {
        matterId: patelMatter.id,
        title: "Client Meeting — Discovery Review",
        type: "MEETING",
        startTime: new Date("2026-08-13T16:00:00Z"),
        location: "Frye Law Group offices",
      },
    ],
  });

  // --- Discovery: Ellis matter (flagship — two productions + comparison) --
  const ellisInitial = await prisma.discoveryProduction.create({
    data: {
      matterId: ellisMatter.id,
      label: "Initial Production",
      source: "County Sheriff's Office (fictional)",
      receivedDate: new Date("2024-11-20"),
      batesPrefix: "ELLIS",
      batesStart: 1,
      batesEnd: 84,
      reviewStatus: "COMPLETE",
    },
  });

  await prisma.discoveryFile.create({
    data: {
      productionId: ellisInitial.id,
      originalFilename: "incident-report.pdf",
      identifier: "ELLIS000001",
      fileType: "PDF",
      pageCount: 12,
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 1/Originals/incident-report.pdf",
    },
  });

  const ellisPropertyInventoryOriginal = await prisma.discoveryFile.create({
    data: {
      productionId: ellisInitial.id,
      originalFilename: "property-inventory.pdf",
      identifier: "ELLIS000009",
      fileType: "PDF",
      pageCount: 2,
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 1/Originals/property-inventory.pdf",
    },
  });

  const ellisLabReport = await prisma.discoveryFile.create({
    data: {
      productionId: ellisInitial.id,
      originalFilename: "lab-report.pdf",
      identifier: "ELLIS000013",
      fileType: "PDF",
      pageCount: 4,
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 1/Originals/lab-report.pdf",
    },
  });

  await prisma.discoveryFile.create({
    data: {
      productionId: ellisInitial.id,
      originalFilename: "bodycam-officer-reyes.mp4",
      identifier: "ELLIS-V001",
      fileType: "VIDEO",
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 1/Originals/bodycam-officer-reyes.mp4",
    },
  });

  await prisma.discoveryFile.create({
    data: {
      productionId: ellisInitial.id,
      originalFilename: "bodycam-officer-diaz.mp4",
      identifier: "ELLIS-V002",
      fileType: "VIDEO",
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 1/Originals/bodycam-officer-diaz.mp4",
    },
  });

  await prisma.discoveryFile.create({
    data: {
      productionId: ellisInitial.id,
      originalFilename: "dispatch-audio.mp3",
      identifier: "ELLIS-A001",
      fileType: "AUDIO",
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 1/Originals/dispatch-audio.mp3",
    },
  });

  await prisma.discoveryFile.create({
    data: {
      productionId: ellisInitial.id,
      originalFilename: "scene-photo-01.jpg",
      identifier: "ELLIS-P001",
      fileType: "PHOTO",
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 1/Originals/scene-photo-01.jpg",
    },
  });

  const ellisScenePhoto02 = await prisma.discoveryFile.create({
    data: {
      productionId: ellisInitial.id,
      originalFilename: "scene-photo-02.jpg",
      identifier: "ELLIS-P002",
      fileType: "PHOTO",
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 1/Originals/scene-photo-02.jpg",
    },
  });

  const ellisSupplemental = await prisma.discoveryProduction.create({
    data: {
      matterId: ellisMatter.id,
      label: "Supplemental Production 1",
      source: "County Sheriff's Office (fictional)",
      receivedDate: new Date("2025-01-15"),
      batesPrefix: "ELLIS",
      batesStart: 85,
      batesEnd: 112,
      reviewStatus: "IN_REVIEW",
    },
  });

  const ellisLabReportAmended = await prisma.discoveryFile.create({
    data: {
      productionId: ellisSupplemental.id,
      originalFilename: "lab-report-amended.pdf",
      identifier: "ELLIS000085",
      fileType: "PDF",
      pageCount: 5,
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 2/Originals/lab-report-amended.pdf",
    },
  });

  const ellisPropertyInventoryDup = await prisma.discoveryFile.create({
    data: {
      productionId: ellisSupplemental.id,
      originalFilename: "property-inventory.pdf",
      identifier: "ELLIS000090",
      fileType: "PDF",
      pageCount: 2,
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 2/Originals/property-inventory.pdf",
    },
  });

  const ellisWitnessStatement = await prisma.discoveryFile.create({
    data: {
      productionId: ellisSupplemental.id,
      originalFilename: "witness-statement-briggs.pdf",
      identifier: "ELLIS000095",
      fileType: "PDF",
      pageCount: 3,
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 2/Originals/witness-statement-briggs.pdf",
    },
  });

  const ellisBodycamDiazDup = await prisma.discoveryFile.create({
    data: {
      productionId: ellisSupplemental.id,
      originalFilename: "bodycam-officer-diaz.mp4",
      identifier: "ELLIS-V002",
      fileType: "VIDEO",
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 2/Originals/bodycam-officer-diaz.mp4",
    },
  });

  const ellisInterview = await prisma.discoveryFile.create({
    data: {
      productionId: ellisSupplemental.id,
      originalFilename: "interview-jordan-ellis.mp3",
      identifier: "ELLIS-A002",
      fileType: "AUDIO",
      originalStorageKey:
        "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Discovery/Production 2/Originals/interview-jordan-ellis.mp3",
    },
  });

  const ellisComparison = await prisma.discoveryComparison.create({
    data: {
      matterId: ellisMatter.id,
      fromProductionId: ellisInitial.id,
      toProductionId: ellisSupplemental.id,
      runAt: new Date("2025-01-16"),
    },
  });

  await prisma.discoveryFileMatch.createMany({
    data: [
      {
        comparisonId: ellisComparison.id,
        status: "NEW",
        filename: ellisWitnessStatement.originalFilename,
        identifier: ellisWitnessStatement.identifier,
        fileId: ellisWitnessStatement.id,
        notes: "New witness statement not previously produced.",
      },
      {
        comparisonId: ellisComparison.id,
        status: "NEW",
        filename: ellisInterview.originalFilename,
        identifier: ellisInterview.identifier,
        fileId: ellisInterview.id,
        notes: "New recorded interview.",
      },
      {
        comparisonId: ellisComparison.id,
        status: "CHANGED",
        filename: "lab-report.pdf",
        identifier: `${ellisLabReport.identifier} → ${ellisLabReportAmended.identifier}`,
        fileId: ellisLabReportAmended.id,
        notes: "Testing conclusion and page count differ from the original lab report — flagged for expert review.",
      },
      {
        comparisonId: ellisComparison.id,
        status: "DUPLICATE",
        filename: "property-inventory.pdf",
        identifier: `${ellisPropertyInventoryOriginal.identifier} / ${ellisPropertyInventoryDup.identifier}`,
        fileId: ellisPropertyInventoryDup.id,
        notes: `Identical to previously produced ${ellisPropertyInventoryOriginal.identifier}.`,
      },
      {
        comparisonId: ellisComparison.id,
        status: "DUPLICATE",
        filename: ellisBodycamDiazDup.originalFilename,
        identifier: ellisBodycamDiazDup.identifier,
        fileId: ellisBodycamDiazDup.id,
        notes: "Re-sent unchanged from the initial production.",
      },
      {
        comparisonId: ellisComparison.id,
        status: "MISSING",
        filename: ellisScenePhoto02.originalFilename,
        identifier: ellisScenePhoto02.identifier,
        fileId: null,
        notes: "Present in the initial production but absent from this batch — follow up with the agency.",
      },
    ],
  });
  // --- Discovery: Alvarez matter -----------------------------------------
  const alvarezProduction = await prisma.discoveryProduction.create({
    data: {
      matterId: alvarezMatter.id,
      label: "Initial Production",
      source: "Municipal Police Department (fictional)",
      receivedDate: new Date("2025-01-30"),
      batesPrefix: "ALVAREZ",
      batesStart: 1,
      batesEnd: 41,
      reviewStatus: "IN_REVIEW",
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
        originalStorageKey:
          "/Frye Law Group/Clients/Alvarez, Maria/24-CR-03190/Discovery/Production 1/Originals/arrest-report.pdf",
      },
      {
        productionId: alvarezProduction.id,
        originalFilename: "dashcam.mp4",
        identifier: "ALVAREZ-V001",
        fileType: "VIDEO",
        originalStorageKey:
          "/Frye Law Group/Clients/Alvarez, Maria/24-CR-03190/Discovery/Production 1/Originals/dashcam.mp4",
      },
      {
        productionId: alvarezProduction.id,
        originalFilename: "911-call.mp3",
        identifier: "ALVAREZ-A001",
        fileType: "AUDIO",
        originalStorageKey:
          "/Frye Law Group/Clients/Alvarez, Maria/24-CR-03190/Discovery/Production 1/Originals/911-call.mp3",
      },
      {
        productionId: alvarezProduction.id,
        originalFilename: "scene-photo.jpg",
        identifier: "ALVAREZ-P001",
        fileType: "PHOTO",
        originalStorageKey:
          "/Frye Law Group/Clients/Alvarez, Maria/24-CR-03190/Discovery/Production 1/Originals/scene-photo.jpg",
      },
    ],
  });

  // --- Discovery: Marsh matter (closed — archived, fully reviewed) -------
  const marshProduction = await prisma.discoveryProduction.create({
    data: {
      matterId: marshMatter.id,
      label: "Initial Production",
      source: "County Sheriff's Office (fictional)",
      receivedDate: new Date("2023-07-05"),
      batesPrefix: "MARSH",
      batesStart: 1,
      batesEnd: 22,
      reviewStatus: "COMPLETE",
    },
  });

  await prisma.discoveryFile.createMany({
    data: [
      {
        productionId: marshProduction.id,
        originalFilename: "incident-report.pdf",
        identifier: "MARSH000001",
        fileType: "PDF",
        pageCount: 8,
        originalStorageKey:
          "/Frye Law Group/Clients/Marsh, Devon/23-CR-09765/Discovery/Production 1/Originals/incident-report.pdf",
      },
      {
        productionId: marshProduction.id,
        originalFilename: "bodycam.mp4",
        identifier: "MARSH-V001",
        fileType: "VIDEO",
        originalStorageKey:
          "/Frye Law Group/Clients/Marsh, Devon/23-CR-09765/Discovery/Production 1/Originals/bodycam.mp4",
      },
    ],
  });

  // --- Discovery: Patel matter (brand new — nothing reviewed yet) --------
  const patelProduction = await prisma.discoveryProduction.create({
    data: {
      matterId: patelMatter.id,
      label: "Initial Production",
      source: "County Police Department (fictional)",
      receivedDate: new Date("2026-08-05"),
      batesPrefix: "PATEL",
      batesStart: 1,
      batesEnd: 18,
      reviewStatus: "NOT_STARTED",
    },
  });

  await prisma.discoveryFile.createMany({
    data: [
      {
        productionId: patelProduction.id,
        originalFilename: "arrest-report.pdf",
        identifier: "PATEL000001",
        fileType: "PDF",
        pageCount: 5,
        originalStorageKey:
          "/Frye Law Group/Clients/Patel, Amara/25-CR-01044/Discovery/Production 1/Originals/arrest-report.pdf",
      },
      {
        productionId: patelProduction.id,
        originalFilename: "bodycam-officer-nguyen.mp4",
        identifier: "PATEL-V001",
        fileType: "VIDEO",
        originalStorageKey:
          "/Frye Law Group/Clients/Patel, Amara/25-CR-01044/Discovery/Production 1/Originals/bodycam-officer-nguyen.mp4",
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
        storageKey: "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Pleadings/entry-of-appearance.pdf",
        uploadedById: priya.id,
      },
      {
        matterId: ellisMatter.id,
        category: "CORRESPONDENCE",
        title: "Letter to prosecutor re: discovery request",
        storageKey: "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Correspondence/2024-11-22-letter-to-da.pdf",
        uploadedById: sarah.id,
      },
      {
        matterId: alvarezMatter.id,
        category: "PLEADING",
        title: "Entry of Appearance",
        storageKey: "/Frye Law Group/Clients/Alvarez, Maria/24-CR-03190/Pleadings/entry-of-appearance.pdf",
        uploadedById: priya.id,
      },
      {
        matterId: marshMatter.id,
        category: "PLEADING",
        title: "Final Disposition Order",
        storageKey: "/Frye Law Group/Clients/Marsh, Devon/23-CR-09765/Pleadings/final-disposition-order.pdf",
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
        recordingDropboxPath:
          "/Frye Law Group/Clients/Ellis, Jordan/24-CR-04821/Calls/2026-07-28-jordan-ellis.m4a",
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
        recordingDropboxPath:
          "/Frye Law Group/Clients/Alvarez, Maria/24-CR-03190/Calls/2026-08-03-maria-alvarez.m4a",
        notes: "Reviewed arraignment prep.",
        filedById: sarah.id,
        filedAt: new Date("2026-08-03T13:20:00Z"),
      },
      {
        matterId: patelMatter.id,
        contactName: "Amara Patel",
        direction: "OUTBOUND",
        fromNumber: "555-0100",
        toNumber: "555-0211",
        occurredAt: new Date("2026-08-07T11:00:00Z"),
        durationSeconds: 240,
        flagged: false,
        notes: "Confirmed arraignment date and next steps.",
        filedById: marcus.id,
        filedAt: new Date("2026-08-07T11:10:00Z"),
      },
      // Unfiled — awaiting a staff member to attach them to the right matter.
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
      {
        matterId: null,
        contactName: "Det. R. Combs (fictional)",
        direction: "INBOUND",
        fromNumber: "555-0475",
        toNumber: "555-0100",
        occurredAt: new Date("2026-08-08T09:30:00Z"),
        durationSeconds: 260,
        flagged: true,
        recordingDropboxPath: "/Frye Law Group/Unfiled Calls/2026-08-08-det-combs.m4a",
        notes: "Says there's additional evidence relevant to an open matter — sounds like the Ellis case. Needs review and filing.",
      },
      {
        matterId: null,
        contactName: "Briggs residence (fictional)",
        direction: "OUTBOUND",
        fromNumber: "555-0100",
        toNumber: "555-0522",
        occurredAt: new Date("2026-08-08T14:15:00Z"),
        durationSeconds: 95,
        flagged: false,
        notes: "Left voicemail for witness callback re: written statement.",
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
        entityId: ellisInitial.id,
        matterId: ellisMatter.id,
        occurredAt: new Date("2024-11-20T11:00:00Z"),
        metadata: { label: ellisInitial.label },
      },
      {
        actorId: priya.id,
        action: "CREATE",
        entityType: "DiscoveryProduction",
        entityId: ellisSupplemental.id,
        matterId: ellisMatter.id,
        occurredAt: new Date("2025-01-15T11:00:00Z"),
        metadata: { label: ellisSupplemental.label },
      },
      {
        actorId: sarah.id,
        action: "VIEW",
        entityType: "DiscoveryComparison",
        entityId: ellisComparison.id,
        matterId: ellisMatter.id,
        occurredAt: new Date("2025-01-16T09:15:00Z"),
        metadata: { fromProduction: ellisInitial.label, toProduction: ellisSupplemental.label },
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
      {
        actorId: marcus.id,
        action: "CREATE",
        entityType: "Matter",
        entityId: patelMatter.id,
        matterId: patelMatter.id,
        occurredAt: new Date("2026-07-20T10:00:00Z"),
        metadata: { caseNumber: patelMatter.caseNumber },
      },
    ],
  });

  console.log("Seed complete:");
  console.log(`  Users: ${await prisma.user.count()}`);
  console.log(`  Clients: ${await prisma.client.count()}`);
  console.log(`  Matters: ${await prisma.matter.count()}`);
  console.log(`  Discovery files: ${await prisma.discoveryFile.count()}`);
  console.log(`  Discovery comparisons: ${await prisma.discoveryComparison.count()}`);
  console.log(`  Calls: ${await prisma.call.count()}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

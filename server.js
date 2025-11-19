import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = 3000;
const dataDir = path.join(process.cwd(), "data");
const publicDir = path.join(process.cwd(), "public");
const uploadProjectsDir = path.join(process.cwd(), "uploads", "projects");
const uploadSubmissionsDir = path.join(process.cwd(), "uploads", "submissions");


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(publicDir));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

const usersFile = path.join(dataDir, "users.txt");
const projectsFile = path.join(dataDir, "projects.txt");
const studentsPrefix = path.join(dataDir, "class_");

const classes = ["CS101", "CS102", "CS103", "EE101", "ME101"];

function createSampleClassFiles() {
  const samples = {
    CS101: [
      ["CS101001", "Alice Johnson"],
      ["CS101002", "Bob Smith"],
      ["CS101003", "Charlie Brown"],
      ["CS101004", "Diana Prince"],
      ["CS101005", "Eve Wilson"],
    ],
    CS102: [
      ["CS102001", "Frank Castle"],
      ["CS102002", "Grace Hopper"],
      ["CS102003", "Henry Ford"],
    ],
    CS103: [["CS103001", "Isaac Newton"]],
    EE101: [["EE101001", "Nikola Tesla"]],
    ME101: [["ME101001", "James Watt"]],
  };
  classes.forEach((cls) => {
    const file = `${studentsPrefix}${cls}.csv`;
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, "RollNo,Name\n" + samples[cls].map((r) => r.join(",")).join("\n"));
    }
  });
}

createSampleClassFiles();

function loadUsers() {
  if (!fs.existsSync(usersFile)) {
    const faculty = ["faculty1", "pass123", "faculty", "Dr. Smith", ""];
    const student = ["student1", "pass123", "student", "John Doe", "CS101"];
    fs.writeFileSync(usersFile, `${faculty.join("|")}\n${student.join("|")}\n`);
  }
  const lines = fs.readFileSync(usersFile, "utf-8").split(/\r?\n/).filter(Boolean);
  const map = new Map();
  lines.forEach((line) => {
    const [username, password, role, name, className] = line.split("|");
    map.set(username, { username, password, role, name, className });
  });
  return map;
}

function saveUsers(users) {
  const content = Array.from(users.values())
    .map((u) => [u.username, u.password, u.role, u.name, u.className || ""].join("|"))
    .join("\n");
  fs.writeFileSync(usersFile, content + "\n");
}

function getCurrentDateTime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function loadClassStudents(className) {
  const file = `${studentsPrefix}${className}.csv`;
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((line) => {
    const [rollNo, name] = line.split(",");
    return { rollNo, name, className, viewed: false, submitted: false, completed: false, submissionFile: "" };
  });
}

function loadProjects() {
  if (!fs.existsSync(projectsFile)) return new Map();
  const lines = fs.readFileSync(projectsFile, "utf-8").split(/\r?\n/).filter(Boolean);
  const map = new Map();
  lines.forEach((line) => {
    const [idStr, title, description, pdfFile, uploadDate, className, facultyName] = line.split("|");
    const id = parseInt(idStr, 10);
    const students = new Map();
    const subFile = path.join(dataDir, `submissions_${id}.txt`);
    if (fs.existsSync(subFile)) {
      const subs = fs.readFileSync(subFile, "utf-8").split(/\r?\n/).filter(Boolean);
      subs.forEach((sline) => {
        const [rollNo, name, sclass, viewedStr, submittedStr, completedStr, submissionFile] = sline.split("|");
        students.set(rollNo, {
          rollNo,
          name,
          className: sclass,
          viewed: viewedStr === "1",
          submitted: submittedStr === "1",
          completed: completedStr === "1",
          submissionFile,
        });
      });
    }
    map.set(id, { id, title, description, pdfFile, uploadDate, className, facultyName, students });
  });
  return map;
}

function saveProjects(projects) {
  const content = Array.from(projects.values())
    .map((p) => [p.id, p.title, p.description, p.pdfFile, p.uploadDate, p.className, p.facultyName].join("|"))
    .join("\n");
  fs.writeFileSync(projectsFile, content + (content ? "\n" : ""));
  Array.from(projects.values()).forEach((p) => {
    const subFile = path.join(dataDir, `submissions_${p.id}.txt`);
    const sContent = Array.from(p.students.values())
      .map((s) => [s.rollNo, s.name, s.className, s.viewed ? "1" : "0", s.submitted ? "1" : "0", s.completed ? "1" : "0", s.submissionFile || ""].join("|")).join("\n");
    fs.writeFileSync(subFile, sContent + (sContent ? "\n" : ""));
  });
}

const storageProjects = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadProjectsDir),
  filename: (_, file, cb) => cb(null, Date.now() + "_" + file.originalname.replace(/\s+/g, "_")),
});

const storageSubmissions = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadSubmissionsDir),
  filename: (_, file, cb) => cb(null, Date.now() + "_" + file.originalname.replace(/\s+/g, "_")),
});

const uploadProjectFile = multer({ storage: storageProjects });
const uploadSubmissionFile = multer({ storage: storageSubmissions });

const sessions = new Map();
const captchas = new Map();

function generateCaptcha() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  const token = uuidv4();
  const expires = Date.now() + 5 * 60 * 1000;
  captchas.set(token, { code, expires });
  return { token, code };
}

function validateCaptcha(token, input) {
  const c = captchas.get(token);
  if (!c) return false;
  if (Date.now() > c.expires) return false;
  return c.code === input;
}

function authRequired(req, res, next) {
  const sid = req.cookies.sid;
  if (!sid) return res.status(401).json({ error: "unauthorized" });
  const session = sessions.get(sid);
  if (!session) return res.status(401).json({ error: "unauthorized" });
  req.user = session.user;
  next();
}

app.get("/api/captcha", (req, res) => {
  const { token, code } = generateCaptcha();
  res.json({ token, code });
});

app.post("/api/register", (req, res) => {
  const users = loadUsers();
  const { username, password, name, role, className } = req.body;
  if (!username || !password || !name || !role) return res.status(400).json({ error: "invalid" });
  if (users.has(username)) return res.status(409).json({ error: "exists" });
  users.set(username, { username, password, role, name, className: role === "student" ? className : "" });
  saveUsers(users);
  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { username, password, token, captcha } = req.body;
  const users = loadUsers();
  if (!validateCaptcha(token, captcha)) return res.status(400).json({ error: "captcha" });
  const u = users.get(username);
  if (!u || u.password !== password) return res.status(401).json({ error: "invalid" });
  const sid = uuidv4();
  sessions.set(sid, { user: u });
  res.cookie("sid", sid, { httpOnly: true });
  res.json({ ok: true, role: u.role });
});

app.post("/api/logout", authRequired, (req, res) => {
  const sid = req.cookies.sid;
  sessions.delete(sid);
  res.clearCookie("sid");
  res.json({ ok: true });
});

app.post("/api/projects", authRequired, uploadProjectFile.single("pdf"), (req, res) => {
  const u = req.user;
  if (u.role !== "faculty") return res.status(403).json({ error: "forbidden" });
  const { title, description, className } = req.body;
  if (!title || !className || !req.file) return res.status(400).json({ error: "invalid" });
  const projects = loadProjects();
  let nextId = 1;
  projects.forEach((p) => {
    if (p.id >= nextId) nextId = p.id + 1;
  });
  const studentsArr = loadClassStudents(className);
  const studentsMap = new Map();
  studentsArr.forEach((s) => studentsMap.set(s.rollNo, s));
  const p = {
    id: nextId,
    title,
    description: description || "",
    pdfFile: path.relative(process.cwd(), req.file.path).replace(/\\/g, "/"),
    uploadDate: getCurrentDateTime(),
    className,
    facultyName: u.name,
    students: studentsMap,
  };
  projects.set(p.id, p);
  saveProjects(projects);
  res.json({ ok: true, projectId: p.id });
});

app.get("/api/projects", authRequired, (req, res) => {
  const u = req.user;
  const projects = loadProjects();
  const list = Array.from(projects.values()).filter((p) =>
    u.role === "faculty" ? p.facultyName === u.name : p.className === u.className
  ).map((p) => {
    let viewed = 0, submitted = 0, completed = 0;
    p.students.forEach((s) => {
      if (s.viewed) viewed++;
      if (s.submitted) submitted++;
      if (s.completed) completed++;
    });
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      uploadDate: p.uploadDate,
      className: p.className,
      facultyName: p.facultyName,
      counts: { total: p.students.size, viewed, submitted, completed },
      pdfFile: p.pdfFile,
    };
  });
  res.json(list);
});

app.get("/api/projects/:id", authRequired, (req, res) => {
  const u = req.user;
  const id = parseInt(req.params.id, 10);
  const projects = loadProjects();
  const p = projects.get(id);
  if (!p) return res.status(404).json({ error: "not_found" });
  if (u.role === "faculty" && p.facultyName !== u.name) return res.status(403).json({ error: "forbidden" });
  if (u.role === "student" && p.className !== u.className) return res.status(403).json({ error: "forbidden" });
  res.json({ id: p.id, title: p.title, description: p.description, className: p.className, pdfFile: p.pdfFile });
});

app.post("/api/projects/:id/view", authRequired, (req, res) => {
  const u = req.user;
  if (u.role !== "student") return res.status(403).json({ error: "forbidden" });
  const id = parseInt(req.params.id, 10);
  const projects = loadProjects();
  const p = projects.get(id);
  if (!p || p.className !== u.className) return res.status(404).json({ error: "not_found" });
  let updated = false;
  p.students.forEach((s, roll) => {
    if (s.name === u.name) {
      p.students.set(roll, { ...s, viewed: true });
      updated = true;
    }
  });
  if (!updated) return res.status(400).json({ error: "not_in_project" });
  saveProjects(projects);
  res.json({ ok: true });
});

app.post("/api/projects/:id/submit", authRequired, uploadSubmissionFile.single("file"), (req, res) => {
  const u = req.user;
  if (u.role !== "student") return res.status(403).json({ error: "forbidden" });
  const id = parseInt(req.params.id, 10);
  const projects = loadProjects();
  const p = projects.get(id);
  if (!p || p.className !== u.className) return res.status(404).json({ error: "not_found" });
  if (!req.file) return res.status(400).json({ error: "invalid" });
  let updated = false;
  p.students.forEach((s, roll) => {
    if (s.name === u.name) {
      p.students.set(roll, { ...s, submitted: true, viewed: true, submissionFile: path.relative(process.cwd(), req.file.path).replace(/\\/g, "/") });
      updated = true;
    }
  });
  if (!updated) return res.status(400).json({ error: "not_in_project" });
  saveProjects(projects);
  res.json({ ok: true });
});

app.get("/api/projects/:id/students", authRequired, (req, res) => {
  const u = req.user;
  if (u.role !== "faculty") return res.status(403).json({ error: "forbidden" });
  const id = parseInt(req.params.id, 10);
  const projects = loadProjects();
  const p = projects.get(id);
  if (!p || p.facultyName !== u.name) return res.status(404).json({ error: "not_found" });
  let arr = Array.from(p.students.values());
  const sort = req.query.sort;
  if (sort === "name") arr.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === "viewed") arr.sort((a, b) => (a.viewed === b.viewed ? 0 : a.viewed ? -1 : 1));
  else if (sort === "submitted") arr.sort((a, b) => (a.submitted === b.submitted ? 0 : a.submitted ? -1 : 1));
  else if (sort === "completed") arr.sort((a, b) => (a.completed === b.completed ? 0 : a.completed ? -1 : 1));
  res.json(arr);
});

app.post("/api/projects/:id/students/:roll/complete", authRequired, (req, res) => {
  const u = req.user;
  if (u.role !== "faculty") return res.status(403).json({ error: "forbidden" });
  const id = parseInt(req.params.id, 10);
  const roll = req.params.roll;
  const { completed } = req.body;
  const projects = loadProjects();
  const p = projects.get(id);
  if (!p || p.facultyName !== u.name) return res.status(404).json({ error: "not_found" });
  const s = p.students.get(roll);
  if (!s) return res.status(404).json({ error: "student_not_found" });
  p.students.set(roll, { ...s, completed: !!completed });
  saveProjects(projects);
  res.json({ ok: true });
});

app.listen(PORT, () => {});
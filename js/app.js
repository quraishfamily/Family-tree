import {
  db, storage, collection, addDoc, onSnapshot, query, orderBy,
  serverTimestamp, ref, uploadBytes, getDownloadURL
} from "./firebase-init.js";

/* ---------------- الهوية (بدون كلمة سر — تعريف بسيط) ---------------- */
const IDENTITY_KEY = "ft_identity_v1";

/* ---------------- فحص أمان: تأكد إن الصفحة فيها كل العناصر المطلوبة ---------------- */
const REQUIRED_IDS = [
  "identityForm", "identityChip", "detailOverlay", "addOverlay",
  "treeContainer", "familyTitle", "draftBar", "draftReviewOverlay",
];
const missingIds = REQUIRED_IDS.filter(id => !document.getElementById(id));
if(missingIds.length > 0){
  document.body.innerHTML = `
    <div class="empty-state">
      <h3>الصفحة ناقصة بعض العناصر</h3>
      <p>يبدو إن محتوى هذه الصفحة (tree.html) غير مطابق بالكامل لآخر نسخة من الكود.</p>
      <p style="color:var(--danger,#c1554a);">العناصر الناقصة: ${missingIds.join(", ")}</p>
      <p>الحل: احذف محتوى tree.html بالكامل والصق آخر نسخة كاملة من الكود من جديد.</p>
    </div>`;
  throw new Error("Missing required page elements: " + missingIds.join(", "));
}

function getIdentity(){
  try{ return JSON.parse(localStorage.getItem(IDENTITY_KEY) || "null"); }
  catch{ return null; }
}
function setIdentity(obj){
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(obj));
  renderIdentityChip();
}
function renderIdentityChip(){
  const chip = document.getElementById("identityChip");
  const id = getIdentity();
  if(id){
    chip.innerHTML = `مسجّل باسم: <strong>${escapeHtml(id.name)}</strong> <button id="editIdentityBtn">تغيير</button>`;
    document.getElementById("editIdentityBtn").onclick = () => openOverlay("identityOverlay");
  } else {
    chip.innerHTML = `<button id="editIdentityBtn">تسجيل بياناتك للمساهمة في الشجرة</button>`;
    document.getElementById("editIdentityBtn").onclick = () => openOverlay("identityOverlay");
  }
}
function ensureIdentity(afterFn){
  const id = getIdentity();
  if(id){ afterFn(); return; }
  pendingAfterIdentity = afterFn;
  openOverlay("identityOverlay");
}
let pendingAfterIdentity = null;

document.getElementById("identityForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("idName").value.trim();
  const email = document.getElementById("idEmail").value.trim();
  const phone = document.getElementById("idPhone").value.trim();
  if(!name || !email || !phone) return;
  setIdentity({ name, email, phone });
  closeOverlay("identityOverlay");
  if(pendingAfterIdentity){ pendingAfterIdentity(); pendingAfterIdentity = null; }
});

/* ---------------- أدوات عامة ---------------- */
function escapeHtml(str=""){
  return str.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function openOverlay(id){ document.getElementById(id).classList.remove("hidden"); }
function closeOverlay(id){ document.getElementById(id).classList.add("hidden"); }
document.querySelectorAll("[data-close]").forEach(btn=>{
  btn.addEventListener("click", ()=> closeOverlay(btn.dataset.close));
});
document.querySelectorAll(".overlay").forEach(ov=>{
  ov.addEventListener("click", (e)=>{ if(e.target === ov) ov.classList.add("hidden"); });
});

/* ---------------- تحديد العائلة الحالية من الرابط ---------------- */
const FAMILIES = {
  quraish:  "آل قريش",
  abbas:    "آل عباس",
  abdrabbo: "آل عبدربه",
  alsaleh:  "الصالح",
};

const urlParams = new URLSearchParams(location.search);
const currentFamily = urlParams.get("family"); // 'quraish' | 'abbas' | 'abdrabbo' | 'alsaleh' | 'all' | null

if(!currentFamily || (currentFamily !== "all" && !FAMILIES[currentFamily])){
  document.body.innerHTML = `
    <div class="empty-state">
      <h3>ما تم تحديد عائلة صحيحة</h3>
      <p>ارجع لصفحة البداية واختر عائلتك.</p>
      <p><a class="btn btn-solid" href="index.html" style="text-decoration:none;display:inline-block;margin-top:14px;">الرجوع لصفحة البداية</a></p>
    </div>`;
  throw new Error("invalid family");
}

document.getElementById("familyTitle").textContent =
  currentFamily === "all" ? "الشجرة الكاملة (كل العوائل)" : `شجرة ${FAMILIES[currentFamily]}`;

/* ---------------- تحميل بيانات الشجرة ---------------- */
let allMembersFlat = [];  // كل الأعضاء بجميع العوائل (تُستخدم في اقتراح الربط بين شخصين)
let membersFlat = [];     // الأعضاء المفلترين حسب العائلة الحالية (تُستخدم لعرض الشجرة)
let currentDetailMember = null;

/* ---------------- مسودة الإضافات السريعة (محلية قبل الإرسال) ---------------- */
const DRAFT_KEY = `ft_draft_${currentFamily}`;
let draftMembers = [];
let draftCounter = 0;

function loadDraft(){
  try{
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if(Array.isArray(saved)){
      draftMembers = saved;
      draftCounter = draftMembers.reduce((max, d) => {
        const n = parseInt(d.localId.replace("d", ""), 10);
        return isNaN(n) ? max : Math.max(max, n);
      }, 0);
    }
  }catch{ draftMembers = []; }
}
function saveDraft(){
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draftMembers));
}
loadDraft();
function updateDraftBar(){
  const bar = document.getElementById("draftBar");
  const count = document.getElementById("draftBarCount");
  if(draftMembers.length === 0){
    bar.classList.add("hidden");
  } else {
    bar.classList.remove("hidden");
    count.textContent = `لديك ${draftMembers.length} ${draftMembers.length === 1 ? "إضافة" : "إضافات"} في المسودة`;
  }
}

function getRenderList(){
  const draftAsMembers = draftMembers.map(d => ({
    id: "draft:" + d.localId,
    localId: d.localId,
    parentId: d.parentKey,
    firstName: d.firstName,
    fullName: d.fullName,
    status: d.status,
    spouseName: d.spouseName,
    isDraft: true,
  }));
  return membersFlat.concat(draftAsMembers);
}

function resolveFamilyId(parentKey){
  if(parentKey && parentKey.startsWith("draft:")){
    const parentLocalId = parentKey.slice(6);
    const parentDraft = draftMembers.find(d => d.localId === parentLocalId);
    return parentDraft ? resolveFamilyId(parentDraft.parentKey) : currentFamily;
  }
  const realParent = allMembersFlat.find(m => m.id === parentKey);
  return realParent ? (realParent.familyId || currentFamily) : currentFamily;
}

const treeContainer = document.getElementById("treeContainer");

const q = query(collection(db, "members"), orderBy("createdAt", "asc"));
onSnapshot(q, (snap) => {
  allMembersFlat = [];
  snap.forEach(d => allMembersFlat.push({ id: d.id, ...d.data() }));
  membersFlat = currentFamily === "all"
    ? allMembersFlat
    : allMembersFlat.filter(m => m.familyId === currentFamily);
  renderTree();
  renderMemberSelects();
}, (err) => {
  treeContainer.innerHTML = `<div class="empty-state"><h3>تعذّر تحميل الشجرة</h3><p>${escapeHtml(err.message)}</p></div>`;
});

function renderMemberSelects(){
  const options = allMembersFlat
    .map(m => `<option value="${m.id}">${escapeHtml(m.firstName)} — ${escapeHtml(m.fullName || "")} (${escapeHtml(FAMILIES[m.familyId] || "بدون عائلة")})</option>`)
    .join("");
  ["linkPersonA", "linkPersonB"].forEach(id=>{
    const sel = document.getElementById(id);
    const current = sel.value;
    sel.innerHTML = `<option value="">— اختر شخصاً —</option>` + options;
    sel.value = current;
  });
}

function buildChildrenMap(){
  const map = {};
  getRenderList().forEach(m => {
    const pid = m.parentId || "__root__";
    if(!map[pid]) map[pid] = [];
    map[pid].push(m);
  });
  return map;
}

function renderTree(){
  if(getRenderList().length === 0){
    treeContainer.innerHTML = `
      <div class="empty-state">
        <h3>الشجرة فاضية حالياً</h3>
        <p>سيقوم المسؤول بإضافة الجد الأول لتبدأ الشجرة بالنمو.</p>
      </div>`;
    return;
  }
  const childrenMap = buildChildrenMap();
  const roots = childrenMap["__root__"] || [];

  const ul = document.createElement("ul");
  ul.className = "tree";
  roots.forEach(root => ul.appendChild(renderNode(root, childrenMap)));
  treeContainer.innerHTML = "";
  treeContainer.appendChild(ul);
}

function renderNode(member, childrenMap){
  const li = document.createElement("li");

  const node = document.createElement("div");
  node.className = "node" + (member.status === "deceased" ? " deceased" : "") + (member.isDraft ? " draft-node" : "");
  node.dataset.id = member.id;

  const initials = (member.firstName || "?").trim().charAt(0);
  node.innerHTML = `
    ${member.isDraft ? `<span class="draft-badge">مسودة</span>` : ""}
    <span class="node-status-dot" title="${member.status === 'deceased' ? 'متوفى' : 'على قيد الحياة'}"></span>
    <div class="node-photo">${member.photoURL ? `<img src="${member.photoURL}" alt="">` : initials}</div>
    <div class="node-name">${escapeHtml(member.firstName || "")}</div>
    <button class="node-add" title="إضافة ابن/ابنة">+</button>
  `;

  node.addEventListener("click", (e) => {
    if(e.target.closest(".node-add")) return;
    showDetail(member);
  });
  node.querySelector(".node-add").addEventListener("click", (e)=>{
    e.stopPropagation();
    openAddRelative("child", member);
  });

  li.appendChild(node);

  const kids = childrenMap[member.id];
  if(kids && kids.length){
    const btn = document.createElement("button");
    btn.className = "node-collapse";
    btn.textContent = "▾ طي";
    let collapsed = false;
    const childUl = document.createElement("ul");
    kids.forEach(k => childUl.appendChild(renderNode(k, childrenMap)));
    btn.addEventListener("click", ()=>{
      collapsed = !collapsed;
      childUl.style.display =

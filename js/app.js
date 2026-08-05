import {
  db, storage, collection, addDoc, onSnapshot, query, orderBy,
  serverTimestamp, ref, uploadBytes, getDownloadURL
} from "./firebase-init.js";
import { initPanZoom } from "./pan-zoom.js";

/* ---------------- الهوية (بدون كلمة سر — تعريف بسيط) ---------------- */
const IDENTITY_KEY = "ft_identity_v1";

/* ---------------- فحص أمان: تأكد إن الصفحة فيها كل العناصر المطلوبة ---------------- */
const REQUIRED_IDS = [
  "identityForm", "identityChip", "detailOverlay", "addOverlay",
  "treeContainer", "familyTitle", "draftBar", "draftReviewOverlay",
  "linkSpouseOverlay", "lineageStopNote", "zoomInBtn", "zoomOutBtn", "zoomResetBtn",
  "searchInput", "searchResults", "newFullNameWarning", "rootFullNameWarning",
  "newBirthYear", "newDeathYearWrap", "newBio", "rootBirthYear", "rootDeathYearWrap", "rootBio",
  "linkSpouseMode", "linkSpouseExistingWrap", "linkSpouseNewWrap", "linkSpouseNewName",
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
    chip.innerHTML = `مسجّل باسم: <strong>${escapeHtml(id.name)}</strong> <button id="editIdentityBtn">تغيير</button> <button id="logoutIdentityBtn">تسجيل الخروج</button>`;
    document.getElementById("editIdentityBtn").onclick = () => openOverlay("identityOverlay");
    document.getElementById("logoutIdentityBtn").onclick = () => {
      if(!confirm("متأكد من تسجيل الخروج؟ لو حبيت تضيف أي شيء بعدين، بنطلب منك تسجيل بياناتك من جديد.")) return;
      localStorage.removeItem(IDENTITY_KEY);
      renderIdentityChip();
    };
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
    gender: d.gender,
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
let panZoomController = null;
let hasFitOnce = false;

function ensurePanZoom(){
  if(!panZoomController){
    panZoomController = initPanZoom(document.querySelector(".tree-wrap"), treeContainer);
    document.getElementById("zoomInBtn").addEventListener("click", ()=> panZoomController.zoomIn());
    document.getElementById("zoomOutBtn").addEventListener("click", ()=> panZoomController.zoomOut());
    document.getElementById("zoomResetBtn").addEventListener("click", ()=> panZoomController.reset());
  }
}

let memberCodes = {};
function computeMemberCodes(){
  const map = {};
  membersFlat.forEach(m=>{
    const pid = m.parentId || "__root__";
    if(!map[pid]) map[pid] = [];
    map[pid].push(m);
  });
  const codes = {};
  function walk(list, prefix){
    list.forEach((node, idx)=>{
      const code = prefix + String(idx + 1);
      codes[node.id] = code;
      const kids = map[node.id];
      if(kids && kids.length) walk(kids, code);
    });
  }
  walk(map["__root__"] || [], "");
  return codes;
}

const q = query(collection(db, "members"), orderBy("createdAt", "asc"));
onSnapshot(q, (snap) => {
  allMembersFlat = [];
  snap.forEach(d => allMembersFlat.push({ id: d.id, ...d.data() }));
  membersFlat = currentFamily === "all"
    ? allMembersFlat
    : allMembersFlat.filter(m => m.familyId === currentFamily);
  memberCodes = computeMemberCodes();
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

  ensurePanZoom();
  if(!hasFitOnce){
    hasFitOnce = true;
    panZoomController.fit();
  }
}

function renderNode(member, childrenMap){
  const li = document.createElement("li");

  const node = document.createElement("div");
  node.className = "node" + (member.status === "deceased" ? " deceased" : "") + (member.isDraft ? " draft-node" : "");
  node.dataset.id = member.id;

  const initials = (member.firstName || "?").trim().charAt(0);
  const codeLabel = (!member.isDraft && memberCodes[member.id]) ? `<div class="node-code">#${memberCodes[member.id]}</div>` : "";
  node.innerHTML = `
    ${member.isDraft ? `<span class="draft-badge">مسودة</span>` : ""}
    <span class="node-status-dot" title="${member.status === 'deceased' ? 'متوفى' : 'على قيد الحياة'}"></span>
    <div class="node-photo">${member.photoURL ? `<img src="${member.photoURL}" alt="">` : initials}</div>
    <div class="node-name">${escapeHtml(member.firstName || "")}</div>
    ${codeLabel}
    <button class="node-add" title="إضافة ابن/ابنة">+</button>
  `;

  node.addEventListener("click", (e) => {
    if(e.target.closest(".node-add")) return;
    showDetail(member);
  });
  node.querySelector(".node-add").addEventListener("click", (e)=>{
    e.stopPropagation();
    const isFemale = member.gender === "female";
    const familySpouse = isFemale && !member.isDraft ? findFamilySpouse(member) : null;
    const lineageBlocked = isFemale && !member.isDraft && !familySpouse;
    if(lineageBlocked){
      showDetail(member); // يفتح التفاصيل ليشوف ملاحظة توقف النسب وخيار ربط الزوج
      return;
    }
    openAddRelative("child", familySpouse || member);
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
      childUl.style.display = collapsed ? "none" : "flex";
      btn.textContent = collapsed ? "▸ توسيع" : "▾ طي";
    });
    li.appendChild(btn);
    li.appendChild(childUl);
  }

  return li;
}

document.getElementById("expandAllBtn").addEventListener("click", ()=>{
  document.querySelectorAll(".tree ul").forEach(u => u.style.display = "flex");
  document.querySelectorAll(".node-collapse").forEach(b => b.textContent = "▾ طي");
});
document.getElementById("collapseAllBtn").addEventListener("click", ()=>{
  document.querySelectorAll(".tree > li > ul").forEach(u => u.style.display = "none");
  document.querySelectorAll(".tree > li > .node-collapse").forEach(b => b.textContent = "▸ توسيع");
});

/* ---------------- تفاصيل الشخص ---------------- */
let addChildRedirectTarget = null; // لو الشخص أنثى ولها زوج بنفس العائلة، نوجّه "إضافة ابن/ابنة" لزوجها

function findFamilySpouse(member){
  if(!member.spouseId) return null;
  const spouse = allMembersFlat.find(m => m.id === member.spouseId);
  if(!spouse) return null;
  if(member.familyId && spouse.familyId !== member.familyId) return null;
  return spouse;
}

function showDetail(member){
  currentDetailMember = member;
  document.getElementById("detailName").textContent = member.firstName || "";
  const codeRow = document.getElementById("detailCodeRow");
  if(!member.isDraft && memberCodes[member.id]){
    codeRow.style.display = "flex";
    document.getElementById("detailCode").textContent = "#" + memberCodes[member.id];
  } else {
    codeRow.style.display = "none";
  }
  document.getElementById("detailFullName").textContent = member.fullName || "—";
  document.getElementById("detailStatus").textContent = member.status === "deceased" ? "متوفى — رحمه الله" : "على قيد الحياة";
  const birthRow = document.getElementById("detailBirthYearRow");
  if(member.birthYear){
    birthRow.style.display = "flex";
    document.getElementById("detailBirthYear").textContent = member.birthYear;
  } else {
    birthRow.style.display = "none";
  }
  const deathRow = document.getElementById("detailDeathYearRow");
  if(member.deathYear){
    deathRow.style.display = "flex";
    document.getElementById("detailDeathYear").textContent = member.deathYear;
  } else {
    deathRow.style.display = "none";
  }
  const bioEl = document.getElementById("detailBioText");
  if(member.bio){
    bioEl.style.display = "block";
    bioEl.textContent = member.bio;
  } else {
    bioEl.style.display = "none";
  }
  const spouseRow = document.getElementById("detailSpouseRow");
  if(member.spouseName){
    spouseRow.style.display = "flex";
    document.getElementById("detailSpouse").textContent = member.spouseName;
  } else {
    spouseRow.style.display = "none";
  }
  const addedByRow = document.getElementById("detailAddedByRow");
  if(member.addedByName){
    addedByRow.style.display = "flex";
    document.getElementById("detailAddedBy").textContent = member.addedByName;
  } else {
    addedByRow.style.display = "none";
  }

  // قاعدة توقف النسب عند الأنثى: ما نسمح بإضافة أبناء مباشرة تحت أنثى إلا لو مربوطة بزوج من نفس العائلة
  addChildRedirectTarget = null;
  const isFemale = member.gender === "female";
  const familySpouse = isFemale && !member.isDraft ? findFamilySpouse(member) : null;
  const lineageBlocked = isFemale && !member.isDraft && !familySpouse;

  document.getElementById("lineageStopNote").style.display = lineageBlocked ? "block" : "none";
  document.getElementById("linkSpouseWrap").style.display = member.isDraft ? "none" : "block";

  const addChildBtn = document.getElementById("openAddChildBtn");
  if(lineageBlocked){
    addChildBtn.style.display = "none";
  } else {
    addChildBtn.style.display = "inline-block";
    if(familySpouse){
      addChildBtn.textContent = `إضافة ابن/ابنة (تحت زوجها: ${familySpouse.firstName})`;
      addChildRedirectTarget = familySpouse;
    } else {
      addChildBtn.textContent = "إضافة ابن / ابنة";
    }
  }

  // زر "إضافة أب" يظهر فقط إذا كان الشخص بدون أب مسجّل حالياً في الشجرة (وليس مسودة)
  document.getElementById("openAddFatherBtn").style.display = (member.parentId || member.isDraft) ? "none" : "inline-block";
  document.getElementById("openChainBtn").style.display = member.isDraft ? "none" : "inline-block";
  document.getElementById("openCorrectionBtn").style.display = member.isDraft ? "none" : "inline-block";
  document.getElementById("removeDraftWrap").style.display = member.isDraft ? "block" : "none";
  openOverlay("detailOverlay");
}

document.getElementById("openAddChildBtn").addEventListener("click", ()=>{
  closeOverlay("detailOverlay");
  openAddRelative("child", addChildRedirectTarget || currentDetailMember);
});
document.getElementById("openAddSiblingBtn").addEventListener("click", ()=>{
  closeOverlay("detailOverlay");
  openAddRelative("sibling", currentDetailMember);
});
document.getElementById("openAddFatherBtn").addEventListener("click", ()=>{
  closeOverlay("detailOverlay");
  openAddRelative("father", currentDetailMember);
});
document.getElementById("openChainBtn").addEventListener("click", ()=>{
  closeOverlay("detailOverlay");
  openChainModal(currentDetailMember);
});
document.getElementById("openCorrectionBtn").addEventListener("click", ()=>{
  ensureIdentity(()=>{
    closeOverlay("detailOverlay");
    document.getElementById("correctionTargetHint").textContent = `بخصوص: ${currentDetailMember.firstName}`;
    document.getElementById("correctionForm").reset();
    document.getElementById("correctionMsg").innerHTML = "";
    openOverlay("correctionOverlay");
  });
});

document.getElementById("correctionForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const msgEl = document.getElementById("correctionMsg");
  msgEl.innerHTML = "";

  const identity = getIdentity();
  if(!identity){ ensureIdentity(()=>{}); return; }

  const issueDescription = document.getElementById("correctionIssue").value.trim();
  const suggestedCorrection = document.getElementById("correctionSuggestion").value.trim();
  if(!issueDescription){ return; }

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "جارٍ الإرسال...";
  try{
    await addDoc(collection(db, "pendingSubmissions"), {
      type: "correction",
      familyId: currentDetailMember.familyId || currentFamily,
      targetMemberId: currentDetailMember.id,
      targetMemberFirstName: currentDetailMember.firstName,
      targetMemberFullName: currentDetailMember.fullName || null,
      issueDescription,
      suggestedCorrection: suggestedCorrection || null,
      submitterName: identity.name,
      submitterEmail: identity.email,
      submitterPhone: identity.phone,
      submittedAt: serverTimestamp(),
    });
    msgEl.innerHTML = `<div class="msg-ok">تم إرسال بلاغك، بيراجعه الأدمن.</div>`;
    setTimeout(()=> closeOverlay("correctionOverlay"), 1600);
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">حدث خطأ: ${escapeHtml(err.message)}</div>`;
  }finally{
    submitBtn.disabled = false;
    submitBtn.textContent = "إرسال البلاغ";
  }
});

document.getElementById("openLinkSpouseBtn").addEventListener("click", ()=>{
  ensureIdentity(()=>{
    closeOverlay("detailOverlay");
    document.getElementById("linkSpouseHint").textContent = `ربط زوج/زوجة لـ: ${currentDetailMember.firstName}`;
    document.getElementById("linkSpouseMode").value = "existing";
    document.getElementById("linkSpouseExistingWrap").style.display = "block";
    document.getElementById("linkSpouseNewWrap").style.display = "none";
    document.getElementById("linkSpouseNewName").value = "";

    const oppositeGender = currentDetailMember.gender === "male" ? "female"
      : currentDetailMember.gender === "female" ? "male" : null;
    const candidates = allMembersFlat.filter(m =>
      m.id !== currentDetailMember.id &&
      (!oppositeGender || m.gender === oppositeGender)
    );
    const sel = document.getElementById("linkSpousePerson");
    sel.innerHTML = `<option value="">— اختر —</option>` + candidates.map(m =>
      `<option value="${m.id}">${escapeHtml(m.firstName)} — ${escapeHtml(m.fullName || "")} (${escapeHtml(FAMILIES[m.familyId] || "")})</option>`
    ).join("");

    document.getElementById("linkSpouseMsg").innerHTML = "";
    openOverlay("linkSpouseOverlay");
  });
});

document.getElementById("linkSpouseMode").addEventListener("change", ()=>{
  const isExisting = document.getElementById("linkSpouseMode").value === "existing";
  document.getElementById("linkSpouseExistingWrap").style.display = isExisting ? "block" : "none";
  document.getElementById("linkSpouseNewWrap").style.display = isExisting ? "none" : "block";
});

document.getElementById("linkSpouseForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const msgEl = document.getElementById("linkSpouseMsg");
  msgEl.innerHTML = "";

  const identity = getIdentity();
  if(!identity){ ensureIdentity(()=>{}); return; }

  const mode = document.getElementById("linkSpouseMode").value;
  const payload = {
    type: "spouseLink",
    familyId: currentDetailMember.familyId || currentFamily,
    targetMemberId: currentDetailMember.id,
    targetMemberFirstName: currentDetailMember.firstName,
    submitterName: identity.name,
    submitterEmail: identity.email,
    submitterPhone: identity.phone,
    submittedAt: serverTimestamp(),
  };

  if(mode === "existing"){
    const spouseId = document.getElementById("linkSpousePerson").value;
    if(!spouseId){
      msgEl.innerHTML = `<div class="msg-err">اختر الزوج/الزوجة قبل الإرسال.</div>`;
      return;
    }
    const spouse = allMembersFlat.find(m => m.id === spouseId);
    payload.spouseMemberId = spouseId;
    payload.spouseMemberFirstName = spouse ? spouse.firstName : "";
  } else {
    const newName = document.getElementById("linkSpouseNewName").value.trim();
    if(!newName){
      msgEl.innerHTML = `<div class="msg-err">اكتب اسم الزوج/الزوجة قبل الإرسال.</div>`;
      return;
    }
    payload.spouseFreeText = newName;
  }

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "جارٍ الإرسال...";
  try{
    await addDoc(collection(db, "pendingSubmissions"), payload);
    msgEl.innerHTML = `<div class="msg-ok">تم إرسال طلب الربط، بيراجعه الأدمن.</div>`;
    setTimeout(()=> closeOverlay("linkSpouseOverlay"), 1600);
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">حدث خطأ: ${escapeHtml(err.message)}</div>`;
  }finally{
    submitBtn.disabled = false;
    submitBtn.textContent = "إرسال طلب الربط";
  }
});

document.getElementById("newStatus").addEventListener("change", ()=>{
  document.getElementById("newDeathYearWrap").style.display =
    document.getElementById("newStatus").value === "deceased" ? "block" : "none";
});
document.getElementById("rootStatus").addEventListener("change", ()=>{
  document.getElementById("rootDeathYearWrap").style.display =
    document.getElementById("rootStatus").value === "deceased" ? "block" : "none";
});

/* ---------------- إضافة فرد جديد (يذهب لمراجعة الأدمن) ---------------- */
let addMode = "child";       // 'child' | 'sibling' | 'father'
let addTargetMember = null;  // الشخص اللي ضغطنا على اسمه لفتح النافذة

const RELATION_LABELS = {
  child:   { title: "إضافة ابن / ابنة", hint: (n) => `سيُضاف كابن/ابنة لـ: ${n}` },
  sibling: { title: "إضافة أخ / أخت",   hint: (n) => `سيُضاف كأخ/أخت لـ: ${n}` },
  father:  { title: "إضافة أب",          hint: (n) => `سيُضاف كأب لـ: ${n}، وسيصبح هو الجد الأعلى في هذا الفرع` },
};

function openAddRelative(mode, targetMember){
  ensureIdentity(()=>{
    addMode = mode;
    addTargetMember = targetMember;
    const labels = RELATION_LABELS[mode];
    document.getElementById("addModalTitle").textContent = labels.title;
    document.getElementById("addParentHint").textContent = labels.hint(targetMember.firstName);
    document.getElementById("addForm").reset();
    document.getElementById("addFormMsg").innerHTML = "";
    document.getElementById("newDeathYearWrap").style.display = "none";
    const genderField = document.getElementById("newGender").closest(".field");
    if(mode === "father"){
      document.getElementById("newGender").value = "male";
      genderField.style.display = "none";
    } else {
      genderField.style.display = "block";
    }
    openOverlay("addOverlay");
  });
}

document.getElementById("addForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const msgEl = document.getElementById("addFormMsg");
  msgEl.innerHTML = "";

  const identity = getIdentity();
  if(!identity){ ensureIdentity(()=>{}); return; }

  const firstName = document.getElementById("newFirstName").value.trim();
  const fullName = document.getElementById("newFullName").value.trim();
  const gender = document.getElementById("newGender").value;
  const status = document.getElementById("newStatus").value;
  const spouseName = document.getElementById("newSpouse").value.trim();
  const birthYear = document.getElementById("newBirthYear").value.trim();
  const deathYear = document.getElementById("newDeathYear").value.trim();
  const bio = document.getElementById("newBio").value.trim();

  if(!firstName || !fullName || !gender){ return; }

  // "ابن/ابنة" و"أخ/أخت" تُضاف فوراً لمسودة محلية (بدون اتصال بالخادم) لتسريع بناء عدة أجيال متتالية
  if(addMode === "child" || addMode === "sibling"){
    const parentKey = addMode === "child" ? addTargetMember.id : (addTargetMember.parentId || null);
    draftCounter += 1;
    draftMembers.push({
      localId: "d" + draftCounter,
      parentKey,
      firstName, fullName, gender, status,
      spouseName: spouseName || null,
      birthYear: birthYear || null,
      deathYear: status === "deceased" ? (deathYear || null) : null,
      bio: bio || null,
    });
    saveDraft();
    renderTree();
    updateDraftBar();
    msgEl.innerHTML = `<div class="msg-ok">أُضيف للمسودة. كمّل الإضافة أو أرسلها من الشريط بالأسفل متى ما انتهيت.</div>`;
    setTimeout(()=> closeOverlay("addOverlay"), 1100);
    return;
  }

  const photoFile = document.getElementById("newPhoto").files[0];
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "جارٍ الإرسال...";

  try{
    let photoURL = null;
    if(photoFile){
      const path = `pending_photos/${Date.now()}_${Math.random().toString(36).slice(2)}_${photoFile.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, photoFile);
      photoURL = await getDownloadURL(storageRef);
    }

    const payload = {
      type: addMode,
      familyId: addTargetMember.familyId || currentFamily,
      firstName, fullName, gender, status,
      spouseName: spouseName || null,
      birthYear: birthYear || null,
      deathYear: status === "deceased" ? (deathYear || null) : null,
      bio: bio || null,
      photoURL,
      submitterName: identity.name,
      submitterEmail: identity.email,
      submitterPhone: identity.phone,
      submittedAt: serverTimestamp(),
    };

    // في هذه النقطة addMode = "father" فقط (child/sibling يُعالَجان أعلاه)
    payload.parentId = null; // الأب الجديد يصبح جذراً حتى تتم مراجعته وربطه
    payload.targetChildId = addTargetMember.id;
    payload.targetChildFirstName = addTargetMember.firstName;

    await addDoc(collection(db, "pendingSubmissions"), payload);

    msgEl.innerHTML = `<div class="msg-ok">تم إرسال طلبك بنجاح، بانتظار مراجعة المسؤول قبل ظهوره في الشجرة.</div>`;
    setTimeout(()=> closeOverlay("addOverlay"), 1600);
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">حدث خطأ: ${escapeHtml(err.message)}</div>`;
  }finally{
    submitBtn.disabled = false;
    submitBtn.textContent = "إرسال للمراجعة";
  }
});

/* ---------------- حذف عنصر من المسودة (مع حذف أبنائه بالمسودة تتابعياً) ---------------- */
document.getElementById("removeDraftBtn").addEventListener("click", ()=>{
  if(!currentDetailMember || !currentDetailMember.isDraft) return;
  const rootLocalId = currentDetailMember.localId;
  const idsToRemove = new Set([rootLocalId]);
  let changed = true;
  while(changed){
    changed = false;
    draftMembers.forEach(d=>{
      const parentLocalId = d.parentKey && d.parentKey.startsWith("draft:") ? d.parentKey.slice(6) : null;
      if(parentLocalId && idsToRemove.has(parentLocalId) && !idsToRemove.has(d.localId)){
        idsToRemove.add(d.localId);
        changed = true;
      }
    });
  }
  if(idsToRemove.size > 1){
    if(!confirm(`هذا الشخص له ${idsToRemove.size - 1} إضافة تابعة له بالمسودة، بيتم حذفها كلها. متأكد؟`)) return;
  }
  draftMembers = draftMembers.filter(d => !idsToRemove.has(d.localId));
  saveDraft();
  renderTree();
  updateDraftBar();
  closeOverlay("detailOverlay");
});

/* ---------------- شريط المسودة: إلغاء الكل / مراجعة وإرسال ---------------- */
document.getElementById("clearDraftBtn").addEventListener("click", ()=>{
  if(!confirm("متأكد من إلغاء كل الإضافات الموجودة بالمسودة؟ لا يمكن التراجع.")) return;
  draftMembers = [];
  saveDraft();
  renderTree();
  updateDraftBar();
});

function draftParentLabel(d){
  if(d.parentKey && d.parentKey.startsWith("draft:")){
    const p = draftMembers.find(x => x.localId === d.parentKey.slice(6));
    return p ? p.firstName : "(عنصر مسودة)";
  }
  const p = allMembersFlat.find(m => m.id === d.parentKey);
  return p ? p.firstName : "جذر جديد";
}

document.getElementById("reviewDraftBtn").addEventListener("click", ()=>{
  const listEl = document.getElementById("draftReviewList");
  document.getElementById("draftReviewMsg").innerHTML = "";
  listEl.innerHTML = draftMembers.map(d => `
    <div class="draft-list-item">
      <span><strong>${escapeHtml(d.firstName)}</strong> (${escapeHtml(d.fullName || "—")}) — تحت: ${escapeHtml(draftParentLabel(d))}</span>
      <button class="btn btn-danger" data-remove-review="${d.localId}">حذف</button>
    </div>
  `).join("");
  listEl.querySelectorAll("[data-remove-review]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const localId = btn.dataset.removeReview;
      const idsToRemove = new Set([localId]);
      let changed = true;
      while(changed){
        changed = false;
        draftMembers.forEach(d=>{
          const parentLocalId = d.parentKey && d.parentKey.startsWith("draft:") ? d.parentKey.slice(6) : null;
          if(parentLocalId && idsToRemove.has(parentLocalId) && !idsToRemove.has(d.localId)){
            idsToRemove.add(d.localId);
            changed = true;
          }
        });
      }
      draftMembers = draftMembers.filter(d => !idsToRemove.has(d.localId));
      saveDraft();
      renderTree();
      updateDraftBar();
      document.getElementById("reviewDraftBtn").click();
    });
  });
  openOverlay("draftReviewOverlay");
});

document.getElementById("submitDraftBatchBtn").addEventListener("click", async ()=>{
  const msgEl = document.getElementById("draftReviewMsg");
  msgEl.innerHTML = "";
  if(draftMembers.length === 0){ return; }

  const invalidDrafts = draftMembers.filter(d => !d.firstName || !d.fullName);
  if(invalidDrafts.length > 0){
    msgEl.innerHTML = `<div class="msg-err">فيه ${invalidDrafts.length} عنصر بالمسودة بدون اسم صالح (ربما من مسودة قديمة). اضغط "حذف" على العناصر الناقصة بالقائمة فوق، أو أعد كتابتها من جديد قبل الإرسال.</div>`;
    return;
  }

  const identity = getIdentity();
  if(!identity){ ensureIdentity(()=>{}); return; }

  const submitBtn = document.getElementById("submitDraftBatchBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "جارٍ الإرسال...";
  try{
    const nodes = draftMembers.map(d => ({
      localId: d.localId,
      parentRef: d.parentKey,
      familyId: resolveFamilyId(d.parentKey),
      firstName: d.firstName,
      fullName: d.fullName,
      gender: d.gender || null,
      status: d.status,
      spouseName: d.spouseName || null,
      birthYear: d.birthYear || null,
      deathYear: d.deathYear || null,
      bio: d.bio || null,
    }));
    await addDoc(collection(db, "pendingSubmissions"), {
      type: "draftBatch",
      nodes,
      submitterName: identity.name,
      submitterEmail: identity.email,
      submitterPhone: identity.phone,
      submittedAt: serverTimestamp(),
    });
    draftMembers = [];
    saveDraft();
    renderTree();
    updateDraftBar();
    msgEl.innerHTML = `<div class="msg-ok">تم إرسال كل الإضافات (${nodes.length}) كطلب واحد، بانتظار مراجعة المسؤول.</div>`;
    setTimeout(()=> closeOverlay("draftReviewOverlay"), 1800);
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">حدث خطأ: ${escapeHtml(err.message)}</div>`;
  }finally{
    submitBtn.disabled = false;
    submitBtn.textContent = "إرسال الكل للمراجعة";
  }
});

/* ---------------- ربط قريب عبر جد مشترك (سلسلة كاملة) ---------------- */
let chainAnchorMember = null;

function openChainModal(member){
  ensureIdentity(()=>{
    chainAnchorMember = member;
    document.getElementById("chainAnchorHint").textContent = `ابدأ من: ${member.firstName}`;
    document.getElementById("chainSteps").innerHTML = "";
    document.getElementById("chainMsg").innerHTML = "";
    addChainStep();
    openOverlay("chainOverlay");
  });
}

function currentPrevLabel(stepEl){
  const steps = [...document.querySelectorAll("#chainSteps .chain-step")];
  const idx = steps.indexOf(stepEl);
  if(idx <= 0) return chainAnchorMember.firstName;
  const prevInput = steps[idx-1].querySelector(".chainFirstName");
  return prevInput.value.trim() || "(الحلقة السابقة)";
}

function refreshPrevLabels(){
  document.querySelectorAll("#chainSteps .chain-step").forEach(stepEl=>{
    const label = currentPrevLabel(stepEl);
    stepEl.querySelectorAll(".prevLabelText").forEach(el => el.textContent = label);
  });
}

function addChainStep(){
  const container = document.getElementById("chainSteps");
  const div = document.createElement("div");
  div.className = "card chain-step";
  div.style.marginBottom = "12px";
  div.innerHTML = `
    <div class="field">
      <label>هذا الشخص هو:</label>
      <select class="chainRelation">
        <option value="father">أب لـ <span class="prevLabelText"></span></option>
        <option value="child">ابن/ابنة لـ <span class="prevLabelText"></span></option>
      </select>
    </div>
    <div class="field"><label>الاسم الأول</label><input type="text" class="chainFirstName"></div>
    <div class="field">
      <label>الاسم الرباعي</label>
      <input type="text" class="chainFullName">
      <div class="chainFullNameWarning dup-warning hidden"></div>
    </div>
    <div class="field">
      <label>الجنس</label>
      <select class="chainGender">
        <option value="">— اختر —</option>
        <option value="male">ذكر</option>
        <option value="female">أنثى</option>
      </select>
    </div>
    <div class="field">
      <label>الحالة</label>
      <select class="chainStatus">
        <option value="alive">على قيد الحياة</option>
        <option value="deceased">متوفى</option>
      </select>
    </div>
    <div class="field"><label>الزوج/الزوجة (اختياري)</label><input type="text" class="chainSpouse"></div>
    <button type="button" class="btn btn-danger removeStepBtn">حذف هذه الحلقة</button>
  `;
  container.appendChild(div);
  const fullNameInput = div.querySelector(".chainFullName");
  const fullNameWarning = div.querySelector(".chainFullNameWarning");
  fullNameInput.addEventListener("input", ()=>{
    const val = fullNameInput.value.trim();
    const matches = findSimilarNames(val, chainAnchorMember ? (chainAnchorMember.familyId || currentFamily) : currentFamily);
    if(matches.length === 0){
      fullNameWarning.classList.add("hidden");
      fullNameWarning.innerHTML = "";
    } else {
      fullNameWarning.classList.remove("hidden");
      fullNameWarning.innerHTML = "⚠️ يوجد اسم مشابه بنفس العائلة: " +
        matches.slice(0, 3).map(m => escapeHtml(m.fullName)).join("، ");
    }
  });
  const firstNameInput = div.querySelector(".chainFirstName");
  firstNameInput.addEventListener("input", ()=>{
    firstNameInput.value = firstNameInput.value.replace(/\s+/g, "");
    refreshPrevLabels();
  });
  div.querySelector(".removeStepBtn").addEventListener("click", ()=>{
    div.remove();
    refreshPrevLabels();
  });
  refreshPrevLabels();
}

document.getElementById("addChainStepBtn").addEventListener("click", addChainStep);

document.getElementById("submitChainBtn").addEventListener("click", async ()=>{
  const msgEl = document.getElementById("chainMsg");
  msgEl.innerHTML = "";
  const stepEls = [...document.querySelectorAll("#chainSteps .chain-step")];
  if(stepEls.length === 0){
    msgEl.innerHTML = `<div class="msg-err">أضف حلقة واحدة على الأقل.</div>`;
    return;
  }
  const steps = [];
  for(const el of stepEls){
    const firstName = el.querySelector(".chainFirstName").value.trim();
    const fullName = el.querySelector(".chainFullName").value.trim();
    const gender = el.querySelector(".chainGender").value;
    if(!firstName || !fullName || !gender){
      msgEl.innerHTML = `<div class="msg-err">أكمل الاسم الأول والرباعي والجنس لكل حلقة قبل الإرسال.</div>`;
      return;
    }
    steps.push({
      relation: el.querySelector(".chainRelation").value,
      firstName, fullName, gender,
      status: el.querySelector(".chainStatus").value,
      spouseName: el.querySelector(".chainSpouse").value.trim() || null,
    });
  }

  // تنبيه غير مانع: النسب عادة يتوقف عند الأنثى، تأكد إن هذا مقصود
  const hasFemaleWithChildAfter = steps.some((s, i) => {
    if(i === 0) return false;
    return steps[i-1].gender === "female" && s.relation === "child";
  });
  if(hasFemaleWithChildAfter){
    if(!confirm("تنبيه: فيه حلقة أنثى وبعدها ابن/ابنة مباشرة — عادة النسب يتوقف عند الأنثى إلا لو زوجها من نفس العائلة. متأكد إنك تبي تكمل؟")) return;
  }

  const identity = getIdentity();
  if(!identity){ ensureIdentity(()=>{}); return; }

  const submitBtn = document.getElementById("submitChainBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "جارٍ الإرسال...";
  try{
    await addDoc(collection(db, "pendingSubmissions"), {
      type: "chain",
      familyId: chainAnchorMember.familyId || currentFamily,
      anchorId: chainAnchorMember.id,
      anchorFirstName: chainAnchorMember.firstName,
      steps,
      submitterName: identity.name,
      submitterEmail: identity.email,
      submitterPhone: identity.phone,
      submittedAt: serverTimestamp(),
    });
    msgEl.innerHTML = `<div class="msg-ok">تم إرسال السلسلة كاملة، بانتظار مراجعة المسؤول.</div>`;
    setTimeout(()=> closeOverlay("chainOverlay"), 1600);
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">حدث خطأ: ${escapeHtml(err.message)}</div>`;
  }finally{
    submitBtn.disabled = false;
    submitBtn.textContent = "إرسال السلسلة كاملة للمراجعة";
  }
});

/* ---------------- إضافة فرع عائلي جديد غير متصل ---------------- */
document.getElementById("openNewRootBtn").addEventListener("click", ()=>{
  ensureIdentity(()=>{
    document.getElementById("newRootForm").reset();
    document.getElementById("newRootMsg").innerHTML = "";
    document.getElementById("rootDeathYearWrap").style.display = "none";
    document.getElementById("rootFamilyFieldWrap").style.display = currentFamily === "all" ? "block" : "none";
    openOverlay("newRootOverlay");
  });
});

document.getElementById("newRootForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const msgEl = document.getElementById("newRootMsg");
  msgEl.innerHTML = "";

  const identity = getIdentity();
  if(!identity){ ensureIdentity(()=>{}); return; }

  const familyId = currentFamily === "all" ? document.getElementById("rootFamily").value : currentFamily;
  const firstName = document.getElementById("rootFirstName").value.trim();
  const fullName = document.getElementById("rootFullName").value.trim();
  const gender = document.getElementById("rootGender").value;
  const status = document.getElementById("rootStatus").value;
  const spouseName = document.getElementById("rootSpouse").value.trim();
  const birthYear = document.getElementById("rootBirthYear").value.trim();
  const deathYear = document.getElementById("rootDeathYear").value.trim();
  const bio = document.getElementById("rootBio").value.trim();
  if(!firstName || !fullName || !gender){ return; }

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "جارٍ الإرسال...";
  try{
    await addDoc(collection(db, "pendingSubmissions"), {
      type: "newRoot",
      familyId,
      parentId: null,
      firstName, fullName, gender, status,
      spouseName: spouseName || null,
      birthYear: birthYear || null,
      deathYear: status === "deceased" ? (deathYear || null) : null,
      bio: bio || null,
      photoURL: null,
      submitterName: identity.name,
      submitterEmail: identity.email,
      submitterPhone: identity.phone,
      submittedAt: serverTimestamp(),
    });
    msgEl.innerHTML = `<div class="msg-ok">تم إرسال طلبك، بانتظار مراجعة المسؤول قبل ظهوره كفرع مستقل بالشجرة.</div>`;
    setTimeout(()=> closeOverlay("newRootOverlay"), 1600);
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">حدث خطأ: ${escapeHtml(err.message)}</div>`;
  }finally{
    submitBtn.disabled = false;
    submitBtn.textContent = "إرسال للمراجعة";
  }
});

/* ---------------- اقتراح ربط بين شخصين ---------------- */
document.getElementById("openLinkSuggestionBtn").addEventListener("click", ()=>{
  ensureIdentity(()=>{
    document.getElementById("linkSuggestionForm").reset();
    document.getElementById("linkSuggestionMsg").innerHTML = "";
    openOverlay("linkSuggestionOverlay");
  });
});

document.getElementById("linkSuggestionForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const msgEl = document.getElementById("linkSuggestionMsg");
  msgEl.innerHTML = "";

  const identity = getIdentity();
  if(!identity){ ensureIdentity(()=>{}); return; }

  const personAId = document.getElementById("linkPersonA").value;
  const personBId = document.getElementById("linkPersonB").value;
  const note = document.getElementById("linkNote").value.trim();

  if(!personAId || !personBId){
    msgEl.innerHTML = `<div class="msg-err">اختر الشخصين قبل الإرسال.</div>`;
    return;
  }
  if(personAId === personBId){
    msgEl.innerHTML = `<div class="msg-err">اختر شخصين مختلفين.</div>`;
    return;
  }

  const personA = allMembersFlat.find(m => m.id === personAId);
  const personB = allMembersFlat.find(m => m.id === personBId);

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "جارٍ الإرسال...";
  try{
    await addDoc(collection(db, "pendingSubmissions"), {
      type: "linkSuggestion",
      personAId, personAFirstName: personA ? personA.firstName : "",
      personBId, personBFirstName: personB ? personB.firstName : "",
      note: note || null,
      submitterName: identity.name,
      submitterEmail: identity.email,
      submitterPhone: identity.phone,
      submittedAt: serverTimestamp(),
    });
    msgEl.innerHTML = `<div class="msg-ok">تم إرسال اقتراحك، بينتظر مراجعة الأدمن.</div>`;
    setTimeout(()=> closeOverlay("linkSuggestionOverlay"), 1600);
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">حدث خطأ: ${escapeHtml(err.message)}</div>`;
  }finally{
    submitBtn.disabled = false;
    submitBtn.textContent = "إرسال الاقتراح";
  }
});

/* ---------------- البحث بالاسم ---------------- */
const searchInput = document.getElementById("searchInput");
const searchResultsEl = document.getElementById("searchResults");

searchInput.addEventListener("input", ()=>{
  const q = searchInput.value.trim();
  if(!q){
    searchResultsEl.classList.add("hidden");
    searchResultsEl.innerHTML = "";
    return;
  }
  const matches = getRenderList()
    .filter(m => !m.isDraft && ((m.firstName || "").includes(q) || (m.fullName || "").includes(q)))
    .slice(0, 8);
  if(matches.length === 0){
    searchResultsEl.innerHTML = `<div class="search-result-item" style="color:var(--muted);">لا توجد نتائج</div>`;
    searchResultsEl.classList.remove("hidden");
    return;
  }
  searchResultsEl.innerHTML = matches.map(m => `
    <div class="search-result-item" data-goto="${m.id}">
      ${escapeHtml(m.firstName)} ${memberCodes[m.id] ? `<span style="color:var(--gold);">#${memberCodes[m.id]}</span>` : ""}
      <small>${escapeHtml(m.fullName || "")} — ${escapeHtml(FAMILIES[m.familyId] || "")}</small>
    </div>
  `).join("");
  searchResultsEl.classList.remove("hidden");
  searchResultsEl.querySelectorAll("[data-goto]").forEach(item=>{
    item.addEventListener("click", ()=>{
      goToMember(item.dataset.goto);
      searchResultsEl.classList.add("hidden");
      searchInput.value = "";
    });
  });
});

document.addEventListener("click", (e)=>{
  if(!e.target.closest(".search-box")) searchResultsEl.classList.add("hidden");
});

function goToMember(id){
  // نوسّع كل شيء أول عشان نضمن إن العنصر المطلوب ظاهر بالـ DOM (مو مطوي)
  document.getElementById("expandAllBtn").click();
  requestAnimationFrame(()=>{
    const el = treeContainer.querySelector(`[data-id="${id}"]`);
    if(!el || !panZoomController) return;
    panZoomController.focusOnElement(el, 1.1);
    el.classList.add("search-highlight");
    setTimeout(()=> el.classList.remove("search-highlight"), 3200);
  });
}
/* ---------------- تنبيه تشابه/تكرار الاسم عند الإضافة ---------------- */
function findSimilarNames(fullName, familyId){
  const trimmed = fullName.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if(words.length < 2) return [];
  const keyPart = words.slice(0, 2).join(" ");
  return allMembersFlat.filter(m=>{
    if(!m.fullName) return false;
    if(familyId && m.familyId !== familyId) return false;
    const mWords = m.fullName.trim().split(/\s+/).filter(Boolean);
    return m.fullName.trim() === trimmed || mWords.slice(0, 2).join(" ") === keyPart;
  });
}

function wireDuplicateWarning(inputEl, warningEl, getFamilyId){
  inputEl.addEventListener("input", ()=>{
    const val = inputEl.value.trim();
    const matches = findSimilarNames(val, getFamilyId());
    if(matches.length === 0){
      warningEl.classList.add("hidden");
      warningEl.innerHTML = "";
      return;
    }
    warningEl.classList.remove("hidden");
    warningEl.innerHTML = "⚠️ يوجد بالفعل اسم مشابه بنفس العائلة: " +
      matches.slice(0, 3).map(m => escapeHtml(m.fullName)).join("، ") +
      " — تأكد إنه ليس نفس الشخص قبل الإرسال.";
  });
}

wireDuplicateWarning(
  document.getElementById("newFullName"),
  document.getElementById("newFullNameWarning"),
  () => (addTargetMember && addTargetMember.familyId) || currentFamily
);
wireDuplicateWarning(
  document.getElementById("rootFullName"),
  document.getElementById("rootFullNameWarning"),
  () => currentFamily === "all" ? document.getElementById("rootFamily").value : currentFamily
);

/* ---------------- تصدير الشجرة كصورة أو PDF ---------------- */
const PRINT_COLOR_OVERRIDES = {
  "--navy-deep": "#ffffff",
  "--navy-panel": "#f4f2ec",
  "--navy-panel-2": "#e9e6da",
  "--navy-line": "#c8c2ae",
  "--gold": "#8a6d1f",
  "--gold-light": "#6b5416",
  "--gold-dim": "#a68a3d",
  "--ivory": "#1a1a1a",
  "--muted": "#5a5a5a",
};

async function captureTreeCanvas(){
  const wrap = document.querySelector(".tree-wrap");
  const treeEl = treeContainer.querySelector(".tree");
  if(!treeEl){
    throw new Error("لا توجد بيانات بالشجرة لتصديرها.");
  }
  const prevWrapOverflow = wrap.style.overflow;
  const prevWrapHeight = wrap.style.height;
  const prevTransform = treeContainer.style.transform;
  const prevPosition = treeContainer.style.position;
  const prevPaddingTop = treeEl.style.paddingTop;
  const prevPaddingBottom = treeEl.style.paddingBottom;

  wrap.style.overflow = "visible";
  wrap.style.height = "auto";
  treeContainer.style.transform = "none";
  treeContainer.style.position = "static";
  // هامش أمان مؤقت: أزرار "+" والشارات فوق/تحت كل بطاقة تمتد خارج حدود الصندوق المحسوبة تلقائياً،
  // فبدون هذا الهامش يُقتصّ أعلى وأسفل الشجرة عند الالتقاط
  treeEl.style.paddingTop = "50px";
  treeEl.style.paddingBottom = "60px";
  // ألوان فاتحة موفّرة للحبر وقت التصدير فقط (تُطبَّق كمتغيرات CSS تتوارثها كل عناصر الشجرة)
  Object.entries(PRINT_COLOR_OVERRIDES).forEach(([key, val]) => treeEl.style.setProperty(key, val));

  await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 60));

  // نلتقط عنصر الشجرة (ul.tree) مباشرة بدل الحاوية الخارجية،
  // لأن ul.tree يتمدد تلقائياً (min-width:max-content) ليشمل العرض الكامل الحقيقي للشجرة
  const canvas = await html2canvas(treeEl, { backgroundColor: "#ffffff", scale: 2 });

  wrap.style.overflow = prevWrapOverflow;
  wrap.style.height = prevWrapHeight;
  treeContainer.style.transform = prevTransform;
  treeContainer.style.position = prevPosition;
  treeEl.style.paddingTop = prevPaddingTop;
  treeEl.style.paddingBottom = prevPaddingBottom;
  Object.keys(PRINT_COLOR_OVERRIDES).forEach(key => treeEl.style.removeProperty(key));
  if(panZoomController) panZoomController.fit();

  return canvas;
}

document.getElementById("exportImageBtn").addEventListener("click", async ()=>{
  const btn = document.getElementById("exportImageBtn");
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "جارٍ التجهيز...";
  try{
    const canvas = await captureTreeCanvas();
    canvas.toBlob((blob)=>{
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `family-tree-${currentFamily}-${dateStr}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }catch(err){
    alert("تعذّر التصدير: " + err.message);
  }finally{
    btn.disabled = false; btn.textContent = original;
  }
});

document.getElementById("exportPdfBtn").addEventListener("click", async ()=>{
  const btn = document.getElementById("exportPdfBtn");
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "جارٍ التجهيز...";
  try{
    const canvas = await captureTreeCanvas();
    const { jsPDF } = window.jspdf;
    const orientation = canvas.width > canvas.height ? "l" : "p";
    const pdf = new jsPDF({ orientation, unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
    const dateStr = new Date().toISOString().slice(0, 10);
    pdf.save(`family-tree-${currentFamily}-${dateStr}.pdf`);
  }catch(err){
    alert("تعذّر التصدير: " + err.message);
  }finally{
    btn.disabled = false; btn.textContent = original;
  }
});
/* ---------------- تقييد حقل "الاسم الأول" بكلمة واحدة فقط ---------------- */
function restrictToSingleWord(input){
  input.addEventListener("input", ()=>{
    input.value = input.value.replace(/\s+/g, "");
  });
}
restrictToSingleWord(document.getElementById("newFirstName"));
restrictToSingleWord(document.getElementById("rootFirstName"));

/* ---------------- تشغيل أولي ---------------- */
renderIdentityChip();
updateDraftBar();

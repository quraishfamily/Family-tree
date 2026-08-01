import {
  db, storage, collection, addDoc, onSnapshot, query, orderBy,
  serverTimestamp, ref, uploadBytes, getDownloadURL
} from "./firebase-init.js";

/* ---------------- الهوية (بدون كلمة سر — تعريف بسيط) ---------------- */
const IDENTITY_KEY = "ft_identity_v1";

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

/* ---------------- تحميل بيانات الشجرة ---------------- */
let membersFlat = [];
let currentDetailMember = null;

const treeContainer = document.getElementById("treeContainer");

const q = query(collection(db, "members"), orderBy("createdAt", "asc"));
onSnapshot(q, (snap) => {
  membersFlat = [];
  snap.forEach(d => membersFlat.push({ id: d.id, ...d.data() }));
  renderTree();
}, (err) => {
  treeContainer.innerHTML = `<div class="empty-state"><h3>تعذّر تحميل الشجرة</h3><p>${escapeHtml(err.message)}</p></div>`;
});

function buildChildrenMap(){
  const map = {};
  membersFlat.forEach(m => {
    const pid = m.parentId || "__root__";
    if(!map[pid]) map[pid] = [];
    map[pid].push(m);
  });
  return map;
}

function renderTree(){
  if(membersFlat.length === 0){
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
  node.className = "node" + (member.status === "deceased" ? " deceased" : "");
  node.dataset.id = member.id;

  const initials = (member.firstName || "?").trim().charAt(0);
  node.innerHTML = `
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
function showDetail(member){
  currentDetailMember = member;
  document.getElementById("detailName").textContent = member.firstName || "";
  document.getElementById("detailFullName").textContent = member.fullName || "—";
  document.getElementById("detailStatus").textContent = member.status === "deceased" ? "متوفى — رحمه الله" : "على قيد الحياة";
  const spouseRow = document.getElementById("detailSpouseRow");
  if(member.spouseName){
    spouseRow.style.display = "flex";
    document.getElementById("detailSpouse").textContent = member.spouseName;
  } else {
    spouseRow.style.display = "none";
  }
  // زر "إضافة أب" يظهر فقط إذا كان الشخص بدون أب مسجّل حالياً في الشجرة
  document.getElementById("openAddFatherBtn").style.display = member.parentId ? "none" : "inline-block";
  openOverlay("detailOverlay");
}

document.getElementById("openAddChildBtn").addEventListener("click", ()=>{
  closeOverlay("detailOverlay");
  openAddRelative("child", currentDetailMember);
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
  const status = document.getElementById("newStatus").value;
  const spouseName = document.getElementById("newSpouse").value.trim();
  const photoFile = document.getElementById("newPhoto").files[0];

  if(!firstName || !fullName){ return; }

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
      firstName, fullName, status,
      spouseName: spouseName || null,
      photoURL,
      submitterName: identity.name,
      submitterEmail: identity.email,
      submitterPhone: identity.phone,
      submittedAt: serverTimestamp(),
    };

    if(addMode === "child"){
      payload.parentId = addTargetMember.id;
      payload.parentFirstName = addTargetMember.firstName;
    } else if(addMode === "sibling"){
      payload.parentId = addTargetMember.parentId || null;
      payload.siblingOfId = addTargetMember.id;
      payload.siblingOfFirstName = addTargetMember.firstName;
    } else if(addMode === "father"){
      payload.parentId = null; // الأب الجديد يصبح جذراً حتى تتم مراجعته وربطه
      payload.targetChildId = addTargetMember.id;
      payload.targetChildFirstName = addTargetMember.firstName;
    }

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
    <div class="field"><label>الاسم الرباعي</label><input type="text" class="chainFullName"></div>
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
    if(!firstName || !fullName){
      msgEl.innerHTML = `<div class="msg-err">أكمل الاسم الأول والرباعي لكل حلقة قبل الإرسال.</div>`;
      return;
    }
    steps.push({
      relation: el.querySelector(".chainRelation").value,
      firstName, fullName,
      status: el.querySelector(".chainStatus").value,
      spouseName: el.querySelector(".chainSpouse").value.trim() || null,
    });
  }

  const identity = getIdentity();
  if(!identity){ ensureIdentity(()=>{}); return; }

  const submitBtn = document.getElementById("submitChainBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "جارٍ الإرسال...";
  try{
    await addDoc(collection(db, "pendingSubmissions"), {
      type: "chain",
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

/* ---------------- تقييد حقل "الاسم الأول" بكلمة واحدة فقط ---------------- */
function restrictToSingleWord(input){
  input.addEventListener("input", ()=>{
    input.value = input.value.replace(/\s+/g, "");
  });
}
restrictToSingleWord(document.getElementById("newFirstName"));

/* ---------------- تشغيل أولي ---------------- */
renderIdentityChip();

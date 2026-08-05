import {
  db, storage, auth,
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, serverTimestamp,
  ref, uploadBytes, getDownloadURL,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "./firebase-init.js";
import { initPanZoom } from "./pan-zoom.js";

const FAMILIES = {
  quraish:  "آل قريش",
  abbas:    "آل عباس",
  abdrabbo: "آل عبدربه",
  alsaleh:  "الصالح",
};

function familyLabel(familyId){
  return FAMILIES[familyId] || "بدون عائلة محددة";
}

function escapeHtml(str=""){
  return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ---------------- رسائل "تواصل معنا" ---------------- */
const TYPE_LABELS = { suggestion: "اقتراح تطوير", bug: "ملاحظة أو خطأ", other: "أخرى" };
const feedbackList = document.getElementById("feedbackList");
onSnapshot(query(collection(db, "feedback"), orderBy("submittedAt", "desc")), (snap)=>{
  if(!feedbackList) return;
  const msgs = [];
  snap.forEach(d => msgs.push({ id: d.id, ...d.data() }));
  document.getElementById("feedbackCount").textContent = msgs.length ? `(${msgs.length})` : "";
  if(msgs.length === 0){
    feedbackList.innerHTML = `<div class="card"><p class="card-meta" style="margin:0;">لا توجد رسائل حالياً.</p></div>`;
    return;
  }
  feedbackList.innerHTML = msgs.map(m => `
    <div class="card">
      <div class="card-head">
        <div>
          <h4>${escapeHtml(m.name || "—")}</h4>
          <div class="card-meta">
            ${escapeHtml(m.contact || "")}<br>
            النوع: ${TYPE_LABELS[m.type] || m.type || "—"}<br>
            ${formatLogDate(m.submittedAt)}
          </div>
        </div>
      </div>
      <p class="card-meta" style="margin-top:10px;color:var(--ivory);font-size:14px;line-height:1.8;">${escapeHtml(m.message || "")}</p>
      <div class="card-actions">
        <button class="btn btn-ghost" data-del-feedback="${m.id}">حذف</button>
      </div>
    </div>
  `).join("");
  feedbackList.querySelectorAll("[data-del-feedback]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      if(!confirm("متأكد من حذف هذي الرسالة؟")) return;
      await deleteDoc(doc(db, "feedback", btn.dataset.delFeedback));
    });
  });
});

/* ---------------- سجل النشاط ---------------- */
async function logActivity(action, summary){
  try{
    await addDoc(collection(db, "activityLog"), {
      action,
      summary,
      performedBy: auth.currentUser ? auth.currentUser.email : "غير معروف",
      timestamp: serverTimestamp(),
    });
  }catch(err){
    console.error("logActivity failed:", err);
  }
}

function formatLogDate(ts){
  if(!ts || typeof ts.toDate !== "function") return "—";
  const d = ts.toDate();
  return d.toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" });
}

const activityLogList = document.getElementById("activityLogList");
onSnapshot(query(collection(db, "activityLog"), orderBy("timestamp", "desc"), limit(200)), (snap)=>{
  if(!activityLogList) return;
  const entries = [];
  snap.forEach(d => entries.push(d.data()));
  if(entries.length === 0){
    activityLogList.innerHTML = `<div class="card"><p class="card-meta" style="margin:0;">لا يوجد نشاط مسجّل بعد.</p></div>`;
    return;
  }
  activityLogList.innerHTML = entries.map(e => `
    <div class="log-entry">
      <div class="log-meta">
        <span>${escapeHtml(e.performedBy || "غير معروف")}</span>
        <span style="color:var(--muted);font-weight:400;">${formatLogDate(e.timestamp)}</span>
      </div>
      <div class="log-summary">${escapeHtml(e.summary || "")}</div>
    </div>
  `).join("");
});

/* ---------------- تسجيل الدخول ---------------- */
const loginView = document.getElementById("loginView");
const dashboardView = document.getElementById("dashboardView");

document.getElementById("loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const msgEl = document.getElementById("loginMsg");
  msgEl.innerHTML = "";
  try{
    await signInWithEmailAndPassword(auth, email, password);
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">فشل الدخول: ${escapeHtml(err.message)}</div>`;
  }
});

document.getElementById("logoutBtn").addEventListener("click", ()=> signOut(auth));

document.getElementById("exportBackupBtn").addEventListener("click", ()=>{
  if(membersFlat.length === 0){
    alert("لا يوجد بيانات بالشجرة حالياً لتصديرها.");
    return;
  }
  const exportData = membersFlat.map(m=>{
    const copy = { ...m };
    if(copy.createdAt && typeof copy.createdAt.toDate === "function"){
      copy.createdAt = copy.createdAt.toDate().toISOString();
    }
    return copy;
  });
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `family-tree-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

onAuthStateChanged(auth, (user)=>{
  if(user){
    loginView.style.display = "none";
    dashboardView.style.display = "block";
    document.getElementById("whoAmI").textContent = `مسجّل الدخول: ${user.email}`;
    if(adminPanZoomController){
      adminHasFitOnce = true;
      adminPanZoomController.fit();
    }
  } else {
    loginView.style.display = "block";
    dashboardView.style.display = "none";
  }
});

/* ---------------- تقييد حقل "الاسم الأول" بكلمة واحدة فقط ---------------- */
function restrictToSingleWord(input){
  input.addEventListener("input", ()=>{
    input.value = input.value.replace(/\s+/g, "");
  });
}
restrictToSingleWord(document.getElementById("directFirstName"));
restrictToSingleWord(document.getElementById("editFirstName"));
document.getElementById("directStatus").addEventListener("change", ()=>{
  document.getElementById("directDeathYearWrap").style.display =
    document.getElementById("directStatus").value === "deceased" ? "block" : "none";
});
document.querySelectorAll(".tab-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  });
});

/* ---------------- قراءة الأعضاء الحاليين (لكل استخدامات اللوحة) ---------------- */
let membersFlat = [];
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

onSnapshot(query(collection(db, "members"), orderBy("createdAt","asc")), (snap)=>{
  membersFlat = [];
  snap.forEach(d => membersFlat.push({ id: d.id, ...d.data() }));
  memberCodes = computeMemberCodes();
  renderManageList();
  renderParentSelect();
  renderAdminTree();
  renderStatsBar();
});

function computeGenerationDepth(){
  const byId = {};
  membersFlat.forEach(m => byId[m.id] = m);
  function depthOf(m){
    let depth = 1;
    let current = m;
    const visited = new Set();
    while(current.parentId && byId[current.parentId] && !visited.has(current.id)){
      visited.add(current.id);
      current = byId[current.parentId];
      depth++;
    }
    return depth;
  }
  return membersFlat.reduce((max, m) => Math.max(max, depthOf(m)), 0);
}

function renderStatsBar(){
  const bar = document.getElementById("statsBar");
  if(!bar) return;
  const total = membersFlat.length;
  const alive = membersFlat.filter(m => m.status !== "deceased").length;
  const deceased = total - alive;
  const generations = computeGenerationDepth();
  const familyCounts = Object.keys(FAMILIES).map(fid => ({
    label: FAMILIES[fid],
    count: membersFlat.filter(m => m.familyId === fid).length,
  }));

  const cards = [
    { value: total, label: "إجمالي الأفراد" },
    { value: alive, label: "على قيد الحياة" },
    { value: deceased, label: "متوفَون" },
    { value: generations, label: "عدد الأجيال" },
    ...familyCounts.map(f => ({ value: f.count, label: f.label })),
  ];

  bar.innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="stat-value">${c.value}</div>
      <div class="stat-label">${escapeHtml(c.label)}</div>
    </div>
  `).join("");
}

function genderLabel(g){
  return g === "male" ? "ذكر" : g === "female" ? "أنثى" : "؟";
}
function memberLabel(m){
  const code = memberCodes[m.id] ? `#${memberCodes[m.id]} ` : "";
  return `${code}${m.firstName} — ${m.fullName || ""} (${familyLabel(m.familyId)} · ${genderLabel(m.gender)})`;
}

function renderParentSelect(){
  const sel = document.getElementById("directParent");
  const current = sel.value;
  sel.innerHTML = `<option value="">— بدون (جذر الشجرة) —</option>`;
  membersFlat.forEach(m=>{
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = memberLabel(m);
    sel.appendChild(opt);
  });
  sel.value = current;
}

async function approveSingleSubmission(item){
  const baseFields = {
    firstName: item.firstName,
    fullName: item.fullName,
    familyId: item.familyId || null,
    gender: item.gender || null,
    status: item.status,
    spouseName: item.spouseName || null,
    birthYear: item.birthYear || null,
    deathYear: item.deathYear || null,
    bio: item.bio || null,
    photoURL: item.photoURL || null,
    addedByName: item.submitterName || null,
    createdAt: serverTimestamp(),
    approvedBy: auth.currentUser.email,
  };

  if(item.type === "father"){
    const targetChild = membersFlat.find(m => m.id === item.targetChildId);
    const alreadyHasParent = targetChild && targetChild.parentId;
    if(alreadyHasParent){
      const proceed = confirm(
        `تنبيه: "${targetChild.firstName}" صار له أب مسجّل في الشجرة بالفعل.\n` +
        `اضغط "موافق" لإضافة "${item.firstName}" كجذر منفصل بدون ربطه بأحد، أو "إلغاء" لتجاهل الطلب.`
      );
      if(!proceed) return;
      await addDoc(collection(db, "members"), { ...baseFields, parentId: null });
    } else {
      const newFatherRef = await addDoc(collection(db, "members"), { ...baseFields, parentId: null });
      await updateDoc(doc(db, "members", item.targetChildId), { parentId: newFatherRef.id });
    }
  } else {
    await addDoc(collection(db, "members"), { ...baseFields, parentId: item.parentId || null });
  }

  await deleteDoc(doc(db, "pendingSubmissions", item.id));

  const relLabels = { father: "أب", sibling: "أخ/أخت", newRoot: "فرع مستقل جديد", child: "ابن/ابنة" };
  await logActivity("approve_single",
    `وافق على إضافة "${item.firstName}" (${item.fullName || "—"}) كـ${relLabels[item.type] || item.type} — عائلة ${familyLabel(item.familyId)}`
  );
}

async function approveDraftBatch(item){
  const validNodes = item.nodes.filter(n => n.firstName && n.fullName);
  if(validNodes.length < item.nodes.length){
    const proceed = confirm(`تنبيه: ${item.nodes.length - validNodes.length} عنصر من هذا الطلب بدون اسم صالح (بيانات تالفة) وسيتم تجاهله. تكمل بالباقي (${validNodes.length})؟`);
    if(!proceed) return;
  }
  const idMap = {}; // localId -> معرّف حقيقي في Firestore
  let remaining = validNodes.slice();
  let safety = 0;
  while(remaining.length && safety < 500){
    safety++;
    const stillRemaining = [];
    for(const node of remaining){
      let resolvedParentId = null;
      let ready = true;
      if(node.parentRef && node.parentRef.startsWith("draft:")){
        const refLocal = node.parentRef.slice(6);
        if(Object.prototype.hasOwnProperty.call(idMap, refLocal)){
          resolvedParentId = idMap[refLocal];
        } else {
          ready = false;
        }
      } else {
        resolvedParentId = node.parentRef || null;
      }
      if(ready){
        const newRef = await addDoc(collection(db, "members"), {
          firstName: node.firstName,
          fullName: node.fullName,
          familyId: node.familyId || null,
          gender: node.gender || null,
          status: node.status,
          spouseName: node.spouseName || null,
          birthYear: node.birthYear || null,
          deathYear: node.deathYear || null,
          bio: node.bio || null,
          photoURL: null,
          addedByName: item.submitterName || null,
          parentId: resolvedParentId,
          createdAt: serverTimestamp(),
          approvedBy: auth.currentUser.email,
        });
        idMap[node.localId] = newRef.id;
      } else {
        stillRemaining.push(node);
      }
    }
    if(stillRemaining.length === remaining.length){
      throw new Error("تعذّر معالجة بعض عناصر الدفعة بسبب رابط غير صالح بين العناصر.");
    }
    remaining = stillRemaining;
  }
  await deleteDoc(doc(db, "pendingSubmissions", item.id));

  const names = validNodes.map(n => n.firstName).join("، ");
  await logActivity("approve_batch",
    `وافق على دفعة إضافات سريعة (${validNodes.length} ${validNodes.length === 1 ? "شخص" : "أشخاص"}): ${names}`
  );
}

async function approveChainSubmission(item){
  let prevId = item.anchorId;
  for(const step of item.steps){
    const baseFields = {
      firstName: step.firstName,
      fullName: step.fullName,
      familyId: item.familyId || null,
      gender: step.gender || null,
      status: step.status,
      spouseName: step.spouseName || null,
      photoURL: null,
      addedByName: item.submitterName || null,
      createdAt: serverTimestamp(),
      approvedBy: auth.currentUser.email,
    };
    if(step.relation === "father"){
      const prevMember = membersFlat.find(m => m.id === prevId);
      if(prevMember && prevMember.parentId){
        throw new Error(`"${prevMember.firstName}" صار له أب مسجّل بالفعل في الشجرة، ما نقدر نكمل هذه السلسلة تلقائياً. ارفض الطلب وتواصل مع مقدّمه لإعادة الإرسال.`);
      }
      const newRef = await addDoc(collection(db, "members"), { ...baseFields, parentId: null });
      await updateDoc(doc(db, "members", prevId), { parentId: newRef.id });
      prevId = newRef.id;
    } else {
      const newRef = await addDoc(collection(db, "members"), { ...baseFields, parentId: prevId });
      prevId = newRef.id;
    }
  }
  await deleteDoc(doc(db, "pendingSubmissions", item.id));

  const stepNames = item.steps.map(s => s.firstName).join("، ");
  await logActivity("approve_chain",
    `وافق على سلسلة قرابة (${item.steps.length} حلقة) تبدأ من "${item.anchorFirstName}": ${stepNames}`
  );
}

/* ---------------- طلبات الإضافة المعلّقة ---------------- */
const panelPending = document.getElementById("panel-pending");
let pendingItemsGlobal = [];
onSnapshot(collection(db, "pendingSubmissions"), (snap)=>{
  const items = [];
  snap.forEach(d => items.push({ id: d.id, ...d.data() }));
  pendingItemsGlobal = items;
  renderAdminTree();
  document.getElementById("pendingCount").textContent = items.length ? `(${items.length})` : "";

  if(items.length === 0){
    panelPending.innerHTML = `<div class="card"><p class="card-meta" style="margin:0;">لا توجد طلبات إضافة بانتظار المراجعة حالياً.</p></div>`;
    return;
  }

  panelPending.innerHTML = "";
  items.forEach(item=>{
    if(item.type === "chain"){
      const stepsHtml = item.steps.map((s, i)=>{
        const relLabel = s.relation === "father" ? "أب لـ" : "ابن/ابنة لـ";
        const prevName = i === 0 ? item.anchorFirstName : item.steps[i-1].firstName;
        return `
          <div style="padding:8px 0;border-bottom:1px solid var(--navy-line);font-size:14px;">
            <strong>${escapeHtml(s.firstName)}</strong> (${escapeHtml(s.fullName || "—")})
            — ${relLabel} <em>${escapeHtml(prevName || "—")}</em>
            ${s.status === "deceased" ? " · متوفى" : ""}
            ${s.spouseName ? " · الزوج/الزوجة: " + escapeHtml(s.spouseName) : ""}
          </div>`;
      }).join("");
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-head">
          <div>
            <h4>سلسلة ربط جديدة (${item.steps.length} ${item.steps.length === 1 ? "حلقة" : "حلقات"})</h4>
            <div class="card-meta">العائلة: ${escapeHtml(familyLabel(item.familyId))}</div>
            <div class="card-meta">تبدأ من الشخص الموجود بالشجرة: ${escapeHtml(item.anchorFirstName || "—")}</div>
          </div>
          <div class="card-meta">
            مُقدّم الطلب:<br>
            ${escapeHtml(item.submitterName || "")}<br>
            ${escapeHtml(item.submitterEmail || "")}<br>
            ${escapeHtml(item.submitterPhone || "")}
          </div>
        </div>
        <div style="margin-top:10px;">${stepsHtml}</div>
        <div class="card-actions">
          <button class="btn btn-solid" data-approve-chain="${item.id}">قبول ونشر السلسلة كاملة</button>
          <button class="btn btn-danger" data-reject="${item.id}">رفض</button>
        </div>
      `;
      panelPending.appendChild(card);
      return;
    }

    if(item.type === "correction"){
      const targetStillExists = membersFlat.some(m => m.id === item.targetMemberId);
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-head">
          <div>
            <h4>بلاغ تصحيح: ${escapeHtml(item.targetMemberFirstName || "—")}</h4>
            <div class="card-meta">
              الاسم الرباعي المسجّل حالياً: ${escapeHtml(item.targetMemberFullName || "—")}<br>
              العائلة: ${escapeHtml(familyLabel(item.familyId))}
            </div>
          </div>
          <div class="card-meta">
            مُقدّم البلاغ:<br>
            ${escapeHtml(item.submitterName || "")}<br>
            ${escapeHtml(item.submitterEmail || "")}<br>
            ${escapeHtml(item.submitterPhone || "")}
          </div>
        </div>
        <p class="card-meta" style="margin-top:10px;"><strong>الخطأ المُبلَّغ عنه:</strong> ${escapeHtml(item.issueDescription || "—")}</p>
        ${item.suggestedCorrection ? `<p class="card-meta"><strong>الصحيح حسب المُبلِّغ:</strong> ${escapeHtml(item.suggestedCorrection)}</p>` : ""}
        ${!targetStillExists ? `<p class="card-meta" style="color:var(--danger);">تنبيه: هذا الشخص لم يعد موجوداً في الشجرة حالياً.</p>` : ""}
        <div class="card-actions">
          ${targetStillExists ? `<button class="btn btn-solid" data-open-correction-edit="${item.id}" data-target-id="${item.targetMemberId}">فتح للتعديل</button>` : ""}
          <button class="btn btn-ghost" data-archive="${item.id}">أرشفة (تم الاطلاع)</button>
        </div>
      `;
      panelPending.appendChild(card);
      return;
    }

    if(item.type === "draftBatch"){
      function parentLabelFor(node, allNodes){
        if(node.parentRef && node.parentRef.startsWith("draft:")){
          const p = allNodes.find(n => n.localId === node.parentRef.slice(6));
          return p ? p.firstName : "(عنصر ضمن نفس الدفعة)";
        }
        const p = membersFlat.find(m => m.id === node.parentRef);
        return p ? p.firstName : "جذر جديد";
      }
      const nodesHtml = item.nodes.map(n => `
        <div style="padding:8px 0;border-bottom:1px solid var(--navy-line);font-size:14px;">
          <strong>${escapeHtml(n.firstName)}</strong> (${escapeHtml(n.fullName || "—")})
          — تحت: <em>${escapeHtml(parentLabelFor(n, item.nodes))}</em>
          ${n.status === "deceased" ? " · متوفى" : ""}
          ${n.spouseName ? " · الزوج/الزوجة: " + escapeHtml(n.spouseName) : ""}
          · العائلة: ${escapeHtml(familyLabel(n.familyId))}
        </div>`).join("");
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-head">
          <div>
            <h4>دفعة إضافات سريعة (${item.nodes.length} ${item.nodes.length === 1 ? "شخص" : "أشخاص"})</h4>
          </div>
          <div class="card-meta">
            مُقدّم الطلب:<br>
            ${escapeHtml(item.submitterName || "")}<br>
            ${escapeHtml(item.submitterEmail || "")}<br>
            ${escapeHtml(item.submitterPhone || "")}
          </div>
        </div>
        <div class="card-actions" style="margin-top:10px;">
          <button class="btn btn-ghost" data-toggle-draftdetails="${item.id}">عرض تفاصيل الأشخاص المقترحين ▾</button>
        </div>
        <div style="display:none;" id="draftDetails-${item.id}">${nodesHtml}</div>
        <div class="card-actions">
          <button class="btn btn-solid" data-approve-draftbatch="${item.id}">قبول ونشر الكل</button>
          <button class="btn btn-danger" data-reject="${item.id}">رفض الكل</button>
        </div>
      `;
      panelPending.appendChild(card);
      return;
    }

    if(item.type === "spouseLink"){
      const spouseLabel = item.spouseMemberId
        ? escapeHtml(item.spouseMemberFirstName || "—")
        : `${escapeHtml(item.spouseFreeText || "—")} <span style="color:var(--muted);">(غير مسجّل بالشجرة)</span>`;
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-head">
          <div>
            <h4>ربط زواج: ${escapeHtml(item.targetMemberFirstName || "—")} ↔ ${spouseLabel}</h4>
            <div class="card-meta">العائلة: ${escapeHtml(familyLabel(item.familyId))}</div>
          </div>
          <div class="card-meta">
            مُقدّم الطلب:<br>
            ${escapeHtml(item.submitterName || "")}<br>
            ${escapeHtml(item.submitterEmail || "")}<br>
            ${escapeHtml(item.submitterPhone || "")}
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-solid" data-approve-spouselink="${item.id}">قبول ونشر الربط</button>
          <button class="btn btn-danger" data-reject="${item.id}">رفض</button>
        </div>
      `;
      panelPending.appendChild(card);
      return;
    }

    if(item.type === "linkSuggestion"){
      const personA = membersFlat.find(m => m.id === item.personAId);
      const personB = membersFlat.find(m => m.id === item.personBId);
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-head">
          <div>
            <h4>اقتراح ربط: ${escapeHtml(item.personAFirstName || "—")} (${escapeHtml(familyLabel(personA && personA.familyId))}) ↔ ${escapeHtml(item.personBFirstName || "—")} (${escapeHtml(familyLabel(personB && personB.familyId))})</h4>
            <div class="card-meta">${item.note ? escapeHtml(item.note) : "بدون ملاحظة إضافية من مقدّم الاقتراح."}</div>
          </div>
          <div class="card-meta">
            مُقدّم الاقتراح:<br>
            ${escapeHtml(item.submitterName || "")}<br>
            ${escapeHtml(item.submitterEmail || "")}<br>
            ${escapeHtml(item.submitterPhone || "")}
          </div>
        </div>
        <p class="card-meta" style="margin-top:10px;">
          هذا اقتراح فقط ولا يغيّر الشجرة تلقائياً. لو تأكدت من صحة القرابة، روح لتبويب "إدارة الشجرة"،
          اضغط "تعديل" على أحد الشخصين، وحدد الشخص الثاني (أو جداً جديداً) من حقل "الأب/الأم".
        </p>
        <div class="card-actions">
          <button class="btn btn-ghost" data-archive="${item.id}">أرشفة (تم الاطلاع)</button>
        </div>
      `;
      panelPending.appendChild(card);
      return;
    }

    let relationLine;
    if(item.type === "newRoot"){
      relationLine = `سيُضاف كفرع عائلي مستقل (غير متصل بأي شخص حالياً)`;
    } else if(item.type === "father"){
      relationLine = `سيُضاف كأب لـ: ${escapeHtml(item.targetChildFirstName || "—")} (وسيصبح جذراً جديداً في هذا الفرع)`;
    } else if(item.type === "sibling"){
      relationLine = `سيُضاف كأخ/أخت لـ: ${escapeHtml(item.siblingOfFirstName || "—")}`;
    } else {
      relationLine = `يُضاف كابن/ابنة لـ: ${escapeHtml(item.parentFirstName || "جذر جديد")}`;
    }
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-head">
        <div style="display:flex;gap:12px;align-items:center;">
          ${item.photoURL ? `<img class="thumb" src="${item.photoURL}">` : ""}
          <div>
            <h4>${escapeHtml(item.firstName)}</h4>
            <div class="card-meta">
              العائلة: ${escapeHtml(familyLabel(item.familyId))}<br>
              الاسم الرباعي: ${escapeHtml(item.fullName || "—")}<br>
              الحالة: ${item.status === "deceased" ? "متوفى" : "على قيد الحياة"}
              ${item.spouseName ? `<br>الزوج/الزوجة: ${escapeHtml(item.spouseName)}` : ""}<br>
              ${relationLine}
            </div>
          </div>
        </div>
        <div class="card-meta">
          مُقدّم الطلب:<br>
          ${escapeHtml(item.submitterName || "")}<br>
          ${escapeHtml(item.submitterEmail || "")}<br>
          ${escapeHtml(item.submitterPhone || "")}
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-solid" data-approve="${item.id}">قبول ونشر</button>
        <button class="btn btn-danger" data-reject="${item.id}">رفض</button>
      </div>
    `;
    panelPending.appendChild(card);
  });

  panelPending.querySelectorAll("[data-approve]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.approve;
      const item = items.find(i=>i.id === id);
      btn.disabled = true; btn.textContent = "جارٍ النشر...";
      try{
        await approveSingleSubmission(item);
      }catch(err){
        alert("حدث خطأ: " + err.message);
        btn.disabled = false; btn.textContent = "قبول ونشر";
      }
    });
  });
  panelPending.querySelectorAll("[data-reject]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      if(!confirm("متأكد من رفض هذا الطلب؟ لا يمكن التراجع.")) return;
      const id = btn.dataset.reject;
      const item = items.find(i => i.id === id);
      await deleteDoc(doc(db, "pendingSubmissions", id));
      if(item){
        const label = item.firstName ? `"${item.firstName}"` : `(نوع: ${item.type})`;
        await logActivity("reject", `رفض طلب ${label}`);
      }
    });
  });

  panelPending.querySelectorAll("[data-archive]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.archive;
      const item = items.find(i => i.id === id);
      await deleteDoc(doc(db, "pendingSubmissions", id));
      if(item){
        const desc = item.type === "correction"
          ? `بلاغ تصحيح متعلق بـ "${item.targetMemberFirstName || "—"}"`
          : `اقتراح ربط بين "${item.personAFirstName || "—"}" و"${item.personBFirstName || "—"}"`;
        await logActivity("archive", `أرشف ${desc}`);
      }
    });
  });

  panelPending.querySelectorAll("[data-open-correction-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const targetId = btn.dataset.targetId;
      const member = membersFlat.find(m => m.id === targetId);
      if(!member){
        alert("تعذّر إيجاد هذا الشخص، ربما تم حذفه.");
        return;
      }
      document.querySelector('.tab-btn[data-tab="manage"]').click();
      openEdit(member);
    });
  });

  panelPending.querySelectorAll("[data-toggle-draftdetails]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const wrap = document.getElementById("draftDetails-" + btn.dataset.toggleDraftdetails);
      const isHidden = wrap.style.display === "none";
      wrap.style.display = isHidden ? "block" : "none";
      btn.textContent = isHidden ? "إخفاء التفاصيل ▲" : "عرض تفاصيل الأشخاص المقترحين ▾";
    });
  });

  panelPending.querySelectorAll("[data-approve-spouselink]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.approveSpouselink;
      const item = items.find(i=>i.id === id);
      btn.disabled = true; btn.textContent = "جارٍ الربط...";
      try{
        const target = membersFlat.find(m => m.id === item.targetMemberId);
        if(!target){
          throw new Error("الشخص المستهدف لم يعد موجوداً في الشجرة.");
        }
        if(item.spouseMemberId){
          const spouse = membersFlat.find(m => m.id === item.spouseMemberId);
          if(!spouse){
            throw new Error("الزوج/الزوجة المختار لم يعد موجوداً في الشجرة.");
          }
          await updateDoc(doc(db, "members", item.targetMemberId), {
            spouseId: item.spouseMemberId,
            spouseName: spouse.fullName || spouse.firstName,
          });
          await updateDoc(doc(db, "members", item.spouseMemberId), {
            spouseId: item.targetMemberId,
            spouseName: target.fullName || target.firstName,
          });
          await deleteDoc(doc(db, "pendingSubmissions", id));
          await logActivity("spouse_link",
            `وافق على ربط "${target.fullName || target.firstName}" و"${spouse.fullName || spouse.firstName}" كزوجين`
          );
        } else {
          await updateDoc(doc(db, "members", item.targetMemberId), {
            spouseName: item.spouseFreeText,
          });
          await deleteDoc(doc(db, "pendingSubmissions", id));
          await logActivity("spouse_link",
            `وافق على تسجيل "${item.spouseFreeText}" كزوج/زوجة لـ "${target.fullName || target.firstName}" (غير مسجّل بالشجرة)`
          );
        }
      }catch(err){
        alert("حدث خطأ: " + err.message);
        btn.disabled = false; btn.textContent = "قبول ونشر الربط";
      }
    });
  });

  panelPending.querySelectorAll("[data-approve-draftbatch]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.approveDraftbatch;
      const item = items.find(i=>i.id === id);
      btn.disabled = true; btn.textContent = "جارٍ النشر...";
      try{
        await approveDraftBatch(item);
      }catch(err){
        alert("حدث خطأ: " + err.message);
        btn.disabled = false; btn.textContent = "قبول ونشر الكل";
      }
    });
  });

  panelPending.querySelectorAll("[data-approve-chain]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.approveChain;
      const item = items.find(i=>i.id === id);
      btn.disabled = true; btn.textContent = "جارٍ النشر...";
      try{
        await approveChainSubmission(item);
      }catch(err){
        alert("حدث خطأ: " + err.message);
        btn.disabled = false; btn.textContent = "قبول ونشر السلسلة كاملة";
      }
    });
  });
});

/* ---------------- بحث الأدمن بالاسم (للتعديل السريع) ---------------- */
const adminSearchInput = document.getElementById("adminSearchInput");
const adminSearchResultsEl = document.getElementById("adminSearchResults");

adminSearchInput.addEventListener("input", ()=>{
  const q = adminSearchInput.value.trim();
  if(!q){
    adminSearchResultsEl.classList.add("hidden");
    adminSearchResultsEl.innerHTML = "";
    return;
  }
  const matches = membersFlat
    .filter(m => (m.firstName || "").includes(q) || (m.fullName || "").includes(q))
    .slice(0, 8);
  if(matches.length === 0){
    adminSearchResultsEl.innerHTML = `<div class="search-result-item" style="color:var(--muted);">لا توجد نتائج</div>`;
    adminSearchResultsEl.classList.remove("hidden");
    return;
  }
  adminSearchResultsEl.innerHTML = matches.map(m => `
    <div class="search-result-item" data-goto="${m.id}">
      ${escapeHtml(m.firstName)} ${memberCodes[m.id] ? `<span style="color:var(--gold);">#${memberCodes[m.id]}</span>` : ""}
      <small>${escapeHtml(m.fullName || "")} — ${escapeHtml(familyLabel(m.familyId))}</small>
    </div>
  `).join("");
  adminSearchResultsEl.classList.remove("hidden");
  adminSearchResultsEl.querySelectorAll("[data-goto]").forEach(item=>{
    item.addEventListener("click", ()=>{
      const member = membersFlat.find(m => m.id === item.dataset.goto);
      adminSearchResultsEl.classList.add("hidden");
      adminSearchInput.value = "";
      if(!member) return;
      // تأكد إننا بتبويب الشجرة التفاعلية عشان نقدر نوسّط ونبرز الشخص
      document.querySelector('.tab-btn[data-tab="interactive"]').click();
      requestAnimationFrame(()=>{
        const el = adminTreeContainer.querySelector(`[data-id="${member.id}"]`);
        if(el && adminPanZoomController){
          adminPanZoomController.focusOnElement(el, 1.1);
          el.classList.add("search-highlight");
          setTimeout(()=> el.classList.remove("search-highlight"), 3200);
        }
      });
      openEdit(member);
    });
  });
});

document.addEventListener("click", (e)=>{
  if(!e.target.closest(".search-box")) adminSearchResultsEl.classList.add("hidden");
});

/* ==================== الشجرة التفاعلية للأدمن ==================== */
const adminTreeContainer = document.getElementById("adminTreeContainer");
let adminPanZoomController = null;
let adminHasFitOnce = false;

function ensureAdminPanZoom(){
  if(!adminPanZoomController){
    adminPanZoomController = initPanZoom(document.querySelector(".admin-tree-wrap"), adminTreeContainer);
    document.getElementById("adminZoomInBtn").addEventListener("click", ()=> adminPanZoomController.zoomIn());
    document.getElementById("adminZoomOutBtn").addEventListener("click", ()=> adminPanZoomController.zoomOut());
    document.getElementById("adminZoomResetBtn").addEventListener("click", ()=> adminPanZoomController.reset());
  }
}

function buildAdminGhosts(){
  const ghosts = [];
  const overrides = []; // { ghostId, targetId } — يجعل targetId يظهر تحت ghostId بالعرض فقط

  pendingItemsGlobal.forEach(item => {
    if(item.type === "child" || item.type === "sibling"){
      ghosts.push({
        id: "pending:" + item.id, pendingId: item.id, pendingType: item.type,
        parentId: item.parentId || null,
        firstName: item.firstName, fullName: item.fullName, gender: item.gender,
        status: item.status, spouseName: item.spouseName, familyId: item.familyId,
        isGhost: true,
      });
    } else if(item.type === "newRoot"){
      ghosts.push({
        id: "pending:" + item.id, pendingId: item.id, pendingType: item.type,
        parentId: null,
        firstName: item.firstName, fullName: item.fullName, gender: item.gender,
        status: item.status, spouseName: item.spouseName, familyId: item.familyId,
        isGhost: true,
      });
    } else if(item.type === "father"){
      const ghostId = "pending:" + item.id;
      ghosts.push({
        id: ghostId, pendingId: item.id, pendingType: item.type,
        parentId: null,
        firstName: item.firstName, fullName: item.fullName, gender: item.gender,
        status: item.status, spouseName: item.spouseName, familyId: item.familyId,
        isGhost: true,
      });
      overrides.push({ ghostId, targetId: item.targetChildId });
    } else if(item.type === "draftBatch"){
      item.nodes.forEach(node => {
        const ghostId = "pending:" + item.id + ":" + node.localId;
        let parentId;
        if(node.parentRef && node.parentRef.startsWith("draft:")){
          parentId = "pending:" + item.id + ":" + node.parentRef.slice(6);
        } else {
          parentId = node.parentRef || null;
        }
        ghosts.push({
          id: ghostId, pendingId: item.id, pendingType: "draftBatch",
          parentId,
          firstName: node.firstName, fullName: node.fullName, gender: node.gender,
          status: node.status, spouseName: node.spouseName, familyId: node.familyId,
          isGhost: true, groupSize: item.nodes.length, subKey: node.localId,
        });
      });
    } else if(item.type === "chain"){
      let prevId = item.anchorId;
      item.steps.forEach((step, idx) => {
        const ghostId = "pending:" + item.id + ":" + idx;
        let parentId = null;
        if(step.relation === "father"){
          overrides.push({ ghostId, targetId: prevId });
        } else {
          parentId = prevId;
        }
        ghosts.push({
          id: ghostId, pendingId: item.id, pendingType: "chain",
          parentId,
          firstName: step.firstName, fullName: step.fullName, gender: step.gender,
          status: step.status, spouseName: step.spouseName, familyId: item.familyId,
          isGhost: true, groupSize: item.steps.length, subKey: idx,
        });
        prevId = ghostId;
      });
    }
    // linkSuggestion / spouseLink / correction: ما لها موضع واضح بالشجرة، تبقى بتبويب "طلبات الإضافة" فقط
  });

  return { ghosts, overrides };
}

function renderAdminTree(){
  if(!adminTreeContainer) return;
  const { ghosts, overrides } = buildAdminGhosts();
  // ننسخ الأعضاء الحقيقيين حتى نقدر نغيّر parentId المعروض فقط (لعرض حالة "أب"/"سلسلة") بدون التأثير على البيانات الأصلية
  const realCopies = membersFlat.map(m => ({ ...m }));
  const combined = realCopies.concat(ghosts);
  overrides.forEach(ov => {
    const targetNode = combined.find(n => n.id === ov.targetId);
    if(targetNode) targetNode.parentId = ov.ghostId;
  });

  if(combined.length === 0){
    adminTreeContainer.innerHTML = `<div class="empty-state"><h3>لا يوجد أفراد بعد</h3><p>أضف أول فرد من تبويب "إضافة فرد مباشرة".</p></div>`;
    return;
  }
  const childrenMap = {};
  combined.forEach(m=>{
    const pid = m.parentId || "__root__";
    if(!childrenMap[pid]) childrenMap[pid] = [];
    childrenMap[pid].push(m);
  });
  const roots = childrenMap["__root__"] || [];
  const ul = document.createElement("ul");
  ul.className = "tree";
  roots.forEach(r => ul.appendChild(renderAdminNode(r, childrenMap)));
  adminTreeContainer.innerHTML = "";
  adminTreeContainer.appendChild(ul);

  ensureAdminPanZoom();
  if(!adminHasFitOnce && adminTreeContainer.clientWidth > 0){
    adminHasFitOnce = true;
    adminPanZoomController.fit();
  }
}

function renderAdminNode(member, childrenMap){
  const li = document.createElement("li");
  const node = document.createElement("div");
  node.className = "node" + (member.status === "deceased" ? " deceased" : "") + (member.isGhost ? " draft-node" : "");
  node.dataset.id = member.id;

  const initials = (member.firstName || "?").trim().charAt(0);
  const codeLabel = (!member.isGhost && memberCodes[member.id]) ? `<div class="node-code">#${memberCodes[member.id]}</div>` : "";
  node.innerHTML = `
    ${member.isGhost ? `<span class="draft-badge">بانتظار الموافقة</span>` : ""}
    <div class="node-photo">${initials}</div>
    <div class="node-name">${escapeHtml(member.firstName || "")}</div>
    ${codeLabel}
  `;

  if(member.isGhost){
    node.addEventListener("click", ()=> openGhostDetail(member));
  } else {
    node.addEventListener("click", ()=> openEdit(member));
    node.draggable = true;
    node.addEventListener("dragstart", (e)=>{
      e.dataTransfer.setData("text/plain", member.id);
    });
    node.addEventListener("dragover", (e)=>{ e.preventDefault(); node.style.outline = "2px solid var(--gold)"; });
    node.addEventListener("dragleave", ()=>{ node.style.outline = "none"; });
    node.addEventListener("drop", (e)=>{
      e.preventDefault();
      node.style.outline = "none";
      const draggedId = e.dataTransfer.getData("text/plain");
      if(draggedId && draggedId !== member.id){
        openDragRelationChoice(draggedId, member.id);
      }
    });
  }

  li.appendChild(node);
  const kids = childrenMap[member.id];
  if(kids && kids.length){
    const ulKids = document.createElement("ul");
    kids.forEach(k => ulKids.appendChild(renderAdminNode(k, childrenMap)));
    li.appendChild(ulKids);
  }
  return li;
}

/* ---------------- تفاصيل عقدة ذهبية (طلب معلّق) ---------------- */
let currentGhostItemId = null;
let currentGhostItemType = null;
let currentGhostSubKey = null;

const PENDING_TYPE_LABELS = {
  child: "ابن/ابنة", sibling: "أخ/أخت", newRoot: "فرع مستقل جديد",
  father: "أب (سيصبح جذراً جديداً)", draftBatch: "ضمن دفعة إضافات سريعة", chain: "ضمن سلسلة قرابة",
};

function openGhostDetail(ghost){
  currentGhostItemId = ghost.pendingId;
  currentGhostItemType = ghost.pendingType;
  currentGhostSubKey = (ghost.subKey !== undefined) ? ghost.subKey : null;
  document.getElementById("ghostDetailTitle").textContent = ghost.firstName;
  const isGroup = ghost.groupSize && ghost.groupSize > 1;
  const groupNote = isGroup
    ? `<p style="color:var(--gold-light);margin-top:10px;">⚠️ هذا الشخص جزء من مجموعة مكوّنة من ${ghost.groupSize} أشخاص. لو باقي المجموعة صحيحة وهذا الشخص فقط فيه خطأ، تقدر "تعدّل بياناته" أو "تحذفه من المجموعة" بدل رفض الكل.</p>`
    : "";
  document.getElementById("ghostDetailBody").innerHTML = `
    الاسم الرباعي: ${escapeHtml(ghost.fullName || "—")}<br>
    الجنس: ${genderLabel(ghost.gender)}<br>
    الحالة: ${ghost.status === "deceased" ? "متوفى" : "على قيد الحياة"}<br>
    ${ghost.spouseName ? "الزوج/الزوجة: " + escapeHtml(ghost.spouseName) + "<br>" : ""}
    العائلة: ${escapeHtml(familyLabel(ghost.familyId))}<br>
    النوع: ${PENDING_TYPE_LABELS[ghost.pendingType] || ghost.pendingType}
    ${groupNote}
  `;
  document.getElementById("ghostRemoveWrap").style.display = isGroup ? "block" : "none";
  document.getElementById("ghostRejectBtn").textContent = isGroup ? "رفض الكل" : "رفض";
  document.getElementById("ghostDetailOverlay").classList.remove("hidden");
}

document.getElementById("ghostApproveBtn").addEventListener("click", async ()=>{
  const item = pendingItemsGlobal.find(i => i.id === currentGhostItemId);
  if(!item) return;
  const btn = document.getElementById("ghostApproveBtn");
  btn.disabled = true; btn.textContent = "جارٍ النشر...";
  try{
    if(currentGhostItemType === "draftBatch"){
      await approveDraftBatch(item);
    } else if(currentGhostItemType === "chain"){
      await approveChainSubmission(item);
    } else {
      await approveSingleSubmission(item);
    }
    document.getElementById("ghostDetailOverlay").classList.add("hidden");
  }catch(err){
    alert("حدث خطأ: " + err.message);
  }finally{
    btn.disabled = false; btn.textContent = "قبول ونشر";
  }
});
document.getElementById("ghostRejectBtn").addEventListener("click", async ()=>{
  if(!currentGhostItemId) return;
  if(!confirm("متأكد من رفض هذا الطلب؟ لا يمكن التراجع.")) return;
  const item = pendingItemsGlobal.find(i => i.id === currentGhostItemId);
  await deleteDoc(doc(db, "pendingSubmissions", currentGhostItemId));
  if(item){
    const label = item.firstName ? `"${item.firstName}"` : `(نوع: ${item.type})`;
    await logActivity("reject", `رفض طلب ${label} (من الشجرة التفاعلية)`);
  }
  document.getElementById("ghostDetailOverlay").classList.add("hidden");
});

/* ---------------- تعديل شخص واحد ضمن طلب معلّق (مفرد أو ضمن مجموعة) ---------------- */
document.getElementById("ghostEditSingleBtn").addEventListener("click", ()=>{
  const item = pendingItemsGlobal.find(i => i.id === currentGhostItemId);
  if(!item) return;
  let sub;
  if(currentGhostItemType === "draftBatch"){
    sub = item.nodes.find(n => n.localId === currentGhostSubKey);
  } else if(currentGhostItemType === "chain"){
    sub = item.steps[currentGhostSubKey];
  } else {
    sub = item; // نوع مفرد: البيانات على مستوى الطلب نفسه
  }
  if(!sub) return;
  document.getElementById("ghostEditFirstName").value = sub.firstName || "";
  document.getElementById("ghostEditFullName").value = sub.fullName || "";
  document.getElementById("ghostEditGender").value = sub.gender || "male";
  document.getElementById("ghostEditStatus").value = sub.status || "alive";
  document.getElementById("ghostEditSpouse").value = sub.spouseName || "";
  document.getElementById("ghostEditMsg").innerHTML = "";
  document.getElementById("ghostDetailOverlay").classList.add("hidden");
  document.getElementById("ghostEditOverlay").classList.remove("hidden");
});

document.getElementById("ghostEditForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const msgEl = document.getElementById("ghostEditMsg");
  msgEl.innerHTML = "";
  const item = pendingItemsGlobal.find(i => i.id === currentGhostItemId);
  if(!item) return;

  const newFirstName = document.getElementById("ghostEditFirstName").value.trim();
  const newFullName = document.getElementById("ghostEditFullName").value.trim();
  const newGender = document.getElementById("ghostEditGender").value;
  const newStatus = document.getElementById("ghostEditStatus").value;
  const newSpouse = document.getElementById("ghostEditSpouse").value.trim() || null;
  if(!newFirstName || !newFullName){
    msgEl.innerHTML = `<div class="msg-err">أكمل الاسم الأول والرباعي.</div>`;
    return;
  }

  try{
    if(currentGhostItemType === "draftBatch"){
      const updatedNodes = item.nodes.map(n => n.localId === currentGhostSubKey
        ? { ...n, firstName:newFirstName, fullName:newFullName, gender:newGender, status:newStatus, spouseName:newSpouse }
        : n
      );
      await updateDoc(doc(db, "pendingSubmissions", item.id), { nodes: updatedNodes });
    } else if(currentGhostItemType === "chain"){
      const updatedSteps = item.steps.map((s, i) => i === currentGhostSubKey
        ? { ...s, firstName:newFirstName, fullName:newFullName, gender:newGender, status:newStatus, spouseName:newSpouse }
        : s
      );
      await updateDoc(doc(db, "pendingSubmissions", item.id), { steps: updatedSteps });
    } else {
      await updateDoc(doc(db, "pendingSubmissions", item.id), {
        firstName:newFirstName, fullName:newFullName, gender:newGender, status:newStatus, spouseName:newSpouse,
      });
    }
    document.getElementById("ghostEditOverlay").classList.add("hidden");
    await logActivity("edit_pending", `عدّل بيانات "${newFirstName}" ضمن طلب معلّق (${PENDING_TYPE_LABELS[currentGhostItemType] || currentGhostItemType})`);
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">${escapeHtml(err.message)}</div>`;
  }
});

document.getElementById("ghostRemoveSingleBtn").addEventListener("click", async ()=>{
  const item = pendingItemsGlobal.find(i => i.id === currentGhostItemId);
  if(!item) return;
  let removedName = "—";

  if(currentGhostItemType === "draftBatch"){
    const removedNode = item.nodes.find(n => n.localId === currentGhostSubKey);
    removedName = removedNode ? removedNode.firstName : "—";
    const idsToRemove = new Set([currentGhostSubKey]);
    let changed = true;
    while(changed){
      changed = false;
      item.nodes.forEach(n=>{
        const parentLocalId = n.parentRef && n.parentRef.startsWith("draft:") ? n.parentRef.slice(6) : null;
        if(parentLocalId && idsToRemove.has(parentLocalId) && !idsToRemove.has(n.localId)){
          idsToRemove.add(n.localId);
          changed = true;
        }
      });
    }
    const extra = idsToRemove.size - 1;
    const confirmMsg = extra > 0
      ? `هذا الشخص له ${extra} إضافة تابعة له بنفس الطلب، بيتم حذفها كلها معه. متأكد؟`
      : "متأكد من حذف هذا الشخص من الطلب؟ الباقي بيتم قبوله بشكل طبيعي.";
    if(!confirm(confirmMsg)) return;

    const remainingNodes = item.nodes.filter(n => !idsToRemove.has(n.localId));
    if(remainingNodes.length === 0){
      await deleteDoc(doc(db, "pendingSubmissions", item.id));
    } else {
      await updateDoc(doc(db, "pendingSubmissions", item.id), { nodes: remainingNodes });
    }
  } else if(currentGhostItemType === "chain"){
    const removedStep = item.steps[currentGhostSubKey];
    removedName = removedStep ? removedStep.firstName : "—";
    if(!confirm("متأكد من حذف هذه الحلقة من السلسلة؟ الحلقة اللي بعدها بتتصل تلقائياً بالحلقة اللي قبلها.")) return;
    const remainingSteps = item.steps.filter((s, i) => i !== currentGhostSubKey);
    if(remainingSteps.length === 0){
      await deleteDoc(doc(db, "pendingSubmissions", item.id));
    } else {
      await updateDoc(doc(db, "pendingSubmissions", item.id), { steps: remainingSteps });
    }
  }
  document.getElementById("ghostDetailOverlay").classList.add("hidden");
  await logActivity("remove_from_group", `حذف "${removedName}" من مجموعة معلّقة (${PENDING_TYPE_LABELS[currentGhostItemType] || currentGhostItemType})`);
});

/* ---------------- ربط بالسحب والإسقاط ---------------- */
let dragSourceId = null, dragTargetId = null;

function isDescendant(possibleAncestorId, startId){
  let current = membersFlat.find(m => m.id === startId);
  const visited = new Set();
  while(current && current.parentId){
    if(visited.has(current.id)) break;
    visited.add(current.id);
    if(current.parentId === possibleAncestorId) return true;
    current = membersFlat.find(m => m.id === current.parentId);
  }
  return false;
}

function openDragRelationChoice(sourceId, targetId){
  dragSourceId = sourceId;
  dragTargetId = targetId;
  const source = membersFlat.find(m => m.id === sourceId);
  const target = membersFlat.find(m => m.id === targetId);
  if(!source || !target) return;
  document.getElementById("dragRelationText").textContent =
    `${source.firstName}${memberCodes[source.id] ? " #"+memberCodes[source.id] : ""} ← ${target.firstName}${memberCodes[target.id] ? " #"+memberCodes[target.id] : ""}`;
  document.getElementById("dragRelationOverlay").classList.remove("hidden");
}

document.getElementById("dragChildBtn").addEventListener("click", async ()=>{
  if(isDescendant(dragSourceId, dragTargetId)){
    alert("لا يمكن — هذا يسبب حلقة دائرية في الشجرة (الشخص الثاني هو أصلاً من نسل الشخص الأول).");
    return;
  }
  const source = membersFlat.find(m => m.id === dragSourceId);
  const target = membersFlat.find(m => m.id === dragTargetId);
  await updateDoc(doc(db, "members", dragSourceId), { parentId: dragTargetId });
  document.getElementById("dragRelationOverlay").classList.add("hidden");
  await logActivity("drag_link_child",
    `ربط "${source ? source.firstName : dragSourceId}" كابن/ابنة لـ "${target ? target.firstName : dragTargetId}" (بالسحب والإسقاط)`
  );
});

document.getElementById("dragSpouseBtn").addEventListener("click", async ()=>{
  const source = membersFlat.find(m => m.id === dragSourceId);
  const target = membersFlat.find(m => m.id === dragTargetId);
  if(!source || !target) return;
  await updateDoc(doc(db, "members", dragSourceId), { spouseId: dragTargetId, spouseName: target.fullName || target.firstName });
  await updateDoc(doc(db, "members", dragTargetId), { spouseId: dragSourceId, spouseName: source.fullName || source.firstName });
  document.getElementById("dragRelationOverlay").classList.add("hidden");
  await logActivity("drag_link_spouse", `ربط "${source.firstName}" و"${target.firstName}" كزوجين (بالسحب والإسقاط)`);
});

document.getElementById("dragCancelBtn").addEventListener("click", ()=>{
  document.getElementById("dragRelationOverlay").classList.add("hidden");
});

/* ---------------- إدارة الشجرة (تعديل / حذف) ---------------- */
function renderManageList(){
  const wrap = document.getElementById("manageList");
  if(membersFlat.length === 0){
    wrap.innerHTML = `<div class="card"><p class="card-meta" style="margin:0;">لا يوجد أفراد في الشجرة بعد.</p></div>`;
    return;
  }
  const rows = membersFlat.map(m => `
    <tr>
      <td>${m.photoURL ? `<img class="thumb" src="${m.photoURL}">` : "—"}</td>
      <td>${memberCodes[m.id] ? "#" + memberCodes[m.id] : "—"}</td>
      <td>${escapeHtml(m.firstName)}</td>
      <td>${escapeHtml(m.fullName || "—")}</td>
      <td>${escapeHtml(familyLabel(m.familyId))}</td>
      <td>${genderLabel(m.gender)}</td>
      <td>${m.status === "deceased" ? "متوفى" : "حيّ"}</td>
      <td>
        <button class="btn btn-ghost" data-edit="${m.id}">تعديل</button>
        <button class="btn btn-danger" data-del="${m.id}">حذف</button>
      </td>
    </tr>
  `).join("");
  wrap.innerHTML = `<table class="table"><thead><tr>
    <th></th><th>المعرّف</th><th>الاسم</th><th>الرباعي</th><th>العائلة</th><th>الجنس</th><th>الحالة</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;

  wrap.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=> openEdit(membersFlat.find(m=>m.id===btn.dataset.edit)));
  });
  wrap.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.dataset.del;
      const hasChildren = membersFlat.some(m => m.parentId === id);
      if(hasChildren){
        alert("لا يمكن حذف هذا الفرد لأن له أبناء في الشجرة. احذف الأبناء أولاً.");
        return;
      }
      if(!confirm("متأكد من حذف هذا الفرد نهائياً؟")) return;
      const member = membersFlat.find(m => m.id === id);
      await deleteDoc(doc(db, "members", id));
      if(member){
        await logActivity("delete_member", `حذف الشخص "${member.firstName}" (${member.fullName || "—"}) — عائلة ${familyLabel(member.familyId)}`);
      }
    });
  });
}

let editingSnapshot = null;

function openEdit(m){
  editingSnapshot = { ...m };
  document.getElementById("editId").value = m.id;
  document.getElementById("editFamily").value = m.familyId || "quraish";
  document.getElementById("editFirstName").value = m.firstName || "";
  document.getElementById("editFullName").value = m.fullName || "";
  document.getElementById("editGender").value = m.gender || "";
  document.getElementById("editStatus").value = m.status || "alive";
  document.getElementById("editSpouse").value = m.spouseName || "";
  document.getElementById("editBirthYear").value = m.birthYear || "";
  document.getElementById("editDeathYear").value = m.deathYear || "";
  document.getElementById("editBio").value = m.bio || "";
  document.getElementById("editMsg").innerHTML = "";

  const parentSel = document.getElementById("editParent");
  parentSel.innerHTML = `<option value="">— بدون (جذر الشجرة) —</option>`;
  membersFlat
    .filter(other => other.id !== m.id) // ما تخلي الشخص يصير أب لنفسه
    .forEach(other=>{
      const opt = document.createElement("option");
      opt.value = other.id;
      opt.textContent = memberLabel(other);
      parentSel.appendChild(opt);
    });
  parentSel.value = m.parentId || "";

  document.getElementById("editOverlay").classList.remove("hidden");
}
document.querySelectorAll("[data-close]").forEach(btn=>{
  btn.addEventListener("click", ()=> document.getElementById(btn.dataset.close).classList.add("hidden"));
});

document.getElementById("editForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const id = document.getElementById("editId").value;
  const msgEl = document.getElementById("editMsg");
  const newVals = {
    firstName: document.getElementById("editFirstName").value.trim(),
    fullName: document.getElementById("editFullName").value.trim(),
    familyId: document.getElementById("editFamily").value,
    gender: document.getElementById("editGender").value || null,
    status: document.getElementById("editStatus").value,
    spouseName: document.getElementById("editSpouse").value.trim() || null,
    birthYear: document.getElementById("editBirthYear").value.trim() || null,
    deathYear: document.getElementById("editDeathYear").value.trim() || null,
    bio: document.getElementById("editBio").value.trim() || null,
    parentId: document.getElementById("editParent").value || null,
  };
  try{
    await updateDoc(doc(db, "members", id), newVals);
    document.getElementById("editOverlay").classList.add("hidden");

    if(editingSnapshot){
      const fieldLabels = {
        firstName: "الاسم الأول", fullName: "الاسم الرباعي", familyId: "العائلة", gender: "الجنس",
        status: "الحالة", spouseName: "الزوج/الزوجة", birthYear: "سنة الميلاد", deathYear: "سنة الوفاة",
        bio: "النبذة", parentId: "الأب/الأم",
      };
      const changes = [];
      Object.keys(fieldLabels).forEach(key=>{
        let oldVal = editingSnapshot[key] ?? null;
        let newVal = newVals[key] ?? null;
        if(key === "familyId"){ oldVal = familyLabel(editingSnapshot.familyId); newVal = familyLabel(newVals.familyId); }
        if(key === "gender"){ oldVal = genderLabel(editingSnapshot.gender); newVal = genderLabel(newVals.gender); }
        if(key === "status"){ oldVal = editingSnapshot.status === "deceased" ? "متوفى" : "حيّ"; newVal = newVals.status === "deceased" ? "متوفى" : "حيّ"; }
        if(key === "parentId"){
          const oldParent = membersFlat.find(x => x.id === editingSnapshot.parentId);
          const newParent = membersFlat.find(x => x.id === newVals.parentId);
          oldVal = oldParent ? oldParent.firstName : "بدون";
          newVal = newParent ? newParent.firstName : "بدون";
        }
        if(String(oldVal || "") !== String(newVal || "")){
          changes.push(`${fieldLabels[key]}: ${oldVal || "—"} ← ${newVal || "—"}`);
        }
      });
      const summary = changes.length
        ? `عدّل بيانات "${newVals.firstName}": ${changes.join("، ")}`
        : `عدّل بيانات "${newVals.firstName}" (بدون تغييرات ظاهرة)`;
      await logActivity("edit_member", summary);
      editingSnapshot = null;
    }
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">${escapeHtml(err.message)}</div>`;
  }
});

/* ---------------- إضافة فرد مباشرة (بدون مراجعة) ---------------- */
document.getElementById("directAddForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const msgEl = document.getElementById("directAddMsg");
  msgEl.innerHTML = "";
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true; submitBtn.textContent = "جارٍ الإضافة...";

  try{
    const photoFile = document.getElementById("directPhoto").files[0];
    let photoURL = null;
    if(photoFile){
      const path = `member_photos/${Date.now()}_${Math.random().toString(36).slice(2)}_${photoFile.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, photoFile);
      photoURL = await getDownloadURL(storageRef);
    }
    const directFirstName = document.getElementById("directFirstName").value.trim();
    const directFullName = document.getElementById("directFullName").value.trim();
    const directFamilyId = document.getElementById("directFamily").value;
    const directParentId = document.getElementById("directParent").value || null;
    await addDoc(collection(db, "members"), {
      parentId: directParentId,
      familyId: directFamilyId,
      firstName: directFirstName,
      fullName: directFullName,
      gender: document.getElementById("directGender").value || null,
      status: document.getElementById("directStatus").value,
      spouseName: document.getElementById("directSpouse").value.trim() || null,
      birthYear: document.getElementById("directBirthYear").value.trim() || null,
      deathYear: document.getElementById("directDeathYear").value.trim() || null,
      bio: document.getElementById("directBio").value.trim() || null,
      photoURL,
      createdAt: serverTimestamp(),
      approvedBy: auth.currentUser.email,
    });
    msgEl.innerHTML = `<div class="msg-ok">تمت الإضافة إلى الشجرة.</div>`;
    e.target.reset();
    document.getElementById("directDeathYearWrap").style.display = "none";

    const parentMember = membersFlat.find(m => m.id === directParentId);
    await logActivity("direct_add",
      `أضاف مباشرة "${directFirstName}" (${directFullName || "—"}) — عائلة ${familyLabel(directFamilyId)}` +
      (parentMember ? ` كابن/ابنة لـ "${parentMember.firstName}"` : " (جذر جديد)")
    );
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">${escapeHtml(err.message)}</div>`;
  }finally{
    submitBtn.disabled = false; submitBtn.textContent = "إضافة إلى الشجرة";
  }
});

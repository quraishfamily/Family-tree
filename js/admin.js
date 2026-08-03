import {
  db, storage, auth,
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp,
  ref, uploadBytes, getDownloadURL,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "./firebase-init.js";

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

onAuthStateChanged(auth, (user)=>{
  if(user){
    loginView.style.display = "none";
    dashboardView.style.display = "block";
    document.getElementById("whoAmI").textContent = `مسجّل الدخول: ${user.email}`;
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
onSnapshot(query(collection(db, "members"), orderBy("createdAt","asc")), (snap)=>{
  membersFlat = [];
  snap.forEach(d => membersFlat.push({ id: d.id, ...d.data() }));
  renderManageList();
  renderParentSelect();
  renderAdminTree();
});

function genderLabel(g){
  return g === "male" ? "ذكر" : g === "female" ? "أنثى" : "؟";
}
function memberLabel(m){
  return `${m.firstName} — ${m.fullName || ""} (${familyLabel(m.familyId)} · ${genderLabel(m.gender)})`;
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
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-head">
          <div>
            <h4>ربط زواج: ${escapeHtml(item.targetMemberFirstName || "—")} ↔ ${escapeHtml(item.spouseMemberFirstName || "—")}</h4>
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
      await deleteDoc(doc(db, "pendingSubmissions", btn.dataset.reject));
    });
  });

  panelPending.querySelectorAll("[data-archive]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      await deleteDoc(doc(db, "pendingSubmissions", btn.dataset.archive));
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
        const spouse = membersFlat.find(m => m.id === item.spouseMemberId);
        if(!target || !spouse){
          throw new Error("أحد الشخصين لم يعد موجوداً في الشجرة.");
        }
        await updateDoc(doc(db, "members", item.targetMemberId), {
          spouseId: item.spouseMemberId,
          spouseName: spouse.firstName,
        });
        await updateDoc(doc(db, "members", item.spouseMemberId), {
          spouseId: item.targetMemberId,
          spouseName: target.firstName,
        });
        await deleteDoc(doc(db, "pendingSubmissions", id));
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
      const validNodes = item.nodes.filter(n => n.firstName && n.fullName);
      if(validNodes.length < item.nodes.length){
        const proceed = confirm(`تنبيه: ${item.nodes.length - validNodes.length} عنصر من هذا الطلب بدون اسم صالح (بيانات تالفة) وسيتم تجاهله. تكمل بالباقي (${validNodes.length})؟`);
        if(!proceed) return;
      }
      btn.disabled = true; btn.textContent = "جارٍ النشر...";
      try{
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
        await deleteDoc(doc(db, "pendingSubmissions", id));
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
        await deleteDoc(doc(db, "pendingSubmissions", id));
      }catch(err){
        alert("حدث خطأ: " + err.message);
        btn.disabled = false; btn.textContent = "قبول ونشر السلسلة كاملة";
      }
    });
  });
});

/* ==================== الشجرة التفاعلية للأدمن ==================== */
const adminTreeContainer = document.getElementById("adminTreeContainer");

function buildAdminGhosts(){
  // نعرض بالشجرة فقط الأنواع اللي لها مكان واضح ومباشر (ابن/ابنة، أخ/أخت، فرع جديد)
  // الأنواع الأكثر تعقيداً (أب، سلسلة، دفعة، ربط زوج، تصحيح) تبقى بتبويب "طلبات الإضافة"
  return pendingItemsGlobal
    .filter(item => item.type === "child" || item.type === "sibling" || item.type === "newRoot")
    .map(item => ({
      id: "pending:" + item.id,
      pendingId: item.id,
      pendingType: item.type,
      parentId: item.type === "newRoot" ? null : (item.parentId || null),
      firstName: item.firstName,
      fullName: item.fullName,
      gender: item.gender,
      status: item.status,
      spouseName: item.spouseName,
      familyId: item.familyId,
      isGhost: true,
    }));
}

function renderAdminTree(){
  if(!adminTreeContainer) return;
  const combined = membersFlat.concat(buildAdminGhosts());
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
}

function renderAdminNode(member, childrenMap){
  const li = document.createElement("li");
  const node = document.createElement("div");
  node.className = "node" + (member.status === "deceased" ? " deceased" : "") + (member.isGhost ? " draft-node" : "");
  node.dataset.id = member.id;

  const initials = (member.firstName || "?").trim().charAt(0);
  node.innerHTML = `
    ${member.isGhost ? `<span class="draft-badge">بانتظار الموافقة</span>` : ""}
    <div class="node-photo">${initials}</div>
    <div class="node-name">${escapeHtml(member.firstName || "")}</div>
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
function openGhostDetail(ghost){
  currentGhostItemId = ghost.pendingId;
  document.getElementById("ghostDetailTitle").textContent = ghost.firstName;
  document.getElementById("ghostDetailBody").innerHTML = `
    الاسم الرباعي: ${escapeHtml(ghost.fullName || "—")}<br>
    الجنس: ${genderLabel(ghost.gender)}<br>
    الحالة: ${ghost.status === "deceased" ? "متوفى" : "على قيد الحياة"}<br>
    ${ghost.spouseName ? "الزوج/الزوجة: " + escapeHtml(ghost.spouseName) + "<br>" : ""}
    العائلة: ${escapeHtml(familyLabel(ghost.familyId))}<br>
    النوع: ${ghost.pendingType === "newRoot" ? "فرع مستقل جديد" : ghost.pendingType === "sibling" ? "أخ/أخت" : "ابن/ابنة"}
  `;
  document.getElementById("ghostDetailOverlay").classList.remove("hidden");
}
document.getElementById("ghostApproveBtn").addEventListener("click", async ()=>{
  const item = pendingItemsGlobal.find(i => i.id === currentGhostItemId);
  if(!item) return;
  const btn = document.getElementById("ghostApproveBtn");
  btn.disabled = true; btn.textContent = "جارٍ النشر...";
  try{
    await approveSingleSubmission(item);
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
  await deleteDoc(doc(db, "pendingSubmissions", currentGhostItemId));
  document.getElementById("ghostDetailOverlay").classList.add("hidden");
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
  document.getElementById("dragRelationText").textContent = `${source.firstName} ← ${target.firstName}`;
  document.getElementById("dragRelationOverlay").classList.remove("hidden");
}

document.getElementById("dragChildBtn").addEventListener("click", async ()=>{
  if(isDescendant(dragSourceId, dragTargetId)){
    alert("لا يمكن — هذا يسبب حلقة دائرية في الشجرة (الشخص الثاني هو أصلاً من نسل الشخص الأول).");
    return;
  }
  await updateDoc(doc(db, "members", dragSourceId), { parentId: dragTargetId });
  document.getElementById("dragRelationOverlay").classList.add("hidden");
});

document.getElementById("dragSpouseBtn").addEventListener("click", async ()=>{
  const source = membersFlat.find(m => m.id === dragSourceId);
  const target = membersFlat.find(m => m.id === dragTargetId);
  if(!source || !target) return;
  await updateDoc(doc(db, "members", dragSourceId), { spouseId: dragTargetId, spouseName: target.firstName });
  await updateDoc(doc(db, "members", dragTargetId), { spouseId: dragSourceId, spouseName: source.firstName });
  document.getElementById("dragRelationOverlay").classList.add("hidden");
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
    <th></th><th>الاسم</th><th>الرباعي</th><th>العائلة</th><th>الجنس</th><th>الحالة</th><th></th>
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
      await deleteDoc(doc(db, "members", id));
    });
  });
}

function openEdit(m){
  document.getElementById("editId").value = m.id;
  document.getElementById("editFamily").value = m.familyId || "quraish";
  document.getElementById("editFirstName").value = m.firstName || "";
  document.getElementById("editFullName").value = m.fullName || "";
  document.getElementById("editGender").value = m.gender || "";
  document.getElementById("editStatus").value = m.status || "alive";
  document.getElementById("editSpouse").value = m.spouseName || "";
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
  try{
    await updateDoc(doc(db, "members", id), {
      firstName: document.getElementById("editFirstName").value.trim(),
      fullName: document.getElementById("editFullName").value.trim(),
      familyId: document.getElementById("editFamily").value,
      gender: document.getElementById("editGender").value || null,
      status: document.getElementById("editStatus").value,
      spouseName: document.getElementById("editSpouse").value.trim() || null,
      parentId: document.getElementById("editParent").value || null,
    });
    document.getElementById("editOverlay").classList.add("hidden");
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
    await addDoc(collection(db, "members"), {
      parentId: document.getElementById("directParent").value || null,
      familyId: document.getElementById("directFamily").value,
      firstName: document.getElementById("directFirstName").value.trim(),
      fullName: document.getElementById("directFullName").value.trim(),
      gender: document.getElementById("directGender").value || null,
      status: document.getElementById("directStatus").value,
      spouseName: document.getElementById("directSpouse").value.trim() || null,
      photoURL,
      createdAt: serverTimestamp(),
      approvedBy: auth.currentUser.email,
    });
    msgEl.innerHTML = `<div class="msg-ok">تمت الإضافة إلى الشجرة.</div>`;
    e.target.reset();
  }catch(err){
    msgEl.innerHTML = `<div class="msg-err">${escapeHtml(err.message)}</div>`;
  }finally{
    submitBtn.disabled = false; submitBtn.textContent = "إضافة إلى الشجرة";
  }
});

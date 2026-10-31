/**
 * manual.js - Interactive In-App User Manual Module
 */

const ManualModule = {
  currentCategory: 'all',
  searchQuery: '',

  activate() {
    this.render();
    this.bindEvents();
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  bindEvents() {
    const searchInput = document.getElementById('manualSearchInput');
    if (searchInput && !searchInput._bound) {
      searchInput._bound = true;
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim().toLowerCase();
        this.renderTopics();
      });
    }
  },

  selectCategory(category) {
    this.currentCategory = category;
    this.renderCategories();
    this.renderTopics();
  },

  clearSearch() {
    this.searchQuery = '';
    const searchInput = document.getElementById('manualSearchInput');
    if (searchInput) searchInput.value = '';
    this.renderTopics();
  },

  render() {
    this.renderCategories();
    this.renderTopics();
    this.renderShortcutsList();
  },

  renderCategories() {
    const container = document.getElementById('manualCategoryTabs');
    if (!container || typeof ManualData === 'undefined') return;

    const allCategories = ['all', ...new Set(ManualData.topics.map(t => t.category))];
    
    container.innerHTML = allCategories.map(cat => {
      const isSelected = this.currentCategory === cat;
      const label = cat === 'all' ? '📌 ทั้งหมด' : cat;
      const activeClass = isSelected 
        ? 'bg-blue-600 text-white font-extrabold shadow-sm' 
        : 'bg-white text-slate-700 hover:bg-slate-100 font-bold border border-slate-200';

      return `
        <button type="button" 
                onclick="ManualModule.selectCategory('${cat}')" 
                class="px-3.5 py-1.5 rounded-2xl text-xs transition cursor-pointer whitespace-nowrap ${activeClass}">
          ${label}
        </button>
      `;
    }).join('');
  },

  renderShortcutsList() {
    const container = document.getElementById('manualQuickShortcuts');
    if (!container || typeof ManualData === 'undefined') return;

    container.innerHTML = ManualData.shortcuts.map(s => `
      <div class="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 last:border-0">
        <span class="font-bold text-slate-700">${s.description}</span>
        <kbd class="px-2 py-0.5 rounded bg-slate-100 border border-slate-300 font-mono font-bold text-slate-800 text-[11px] shadow-2xs">${s.key}</kbd>
      </div>
    `).join('');
  },

  formatContent(text) {
    if (!text) return '';
    // Format bold
    let formatted = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Format inline code
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-xs text-blue-700 border border-slate-200">$1</code>');
    // Format markdown tables
    if (formatted.includes('|')) {
      const lines = formatted.split('\n');
      let inTable = false;
      let tableHtml = '<div class="overflow-x-auto my-3"><table class="min-w-full text-xs text-left border border-slate-200 rounded-xl overflow-hidden">';
      const newLines = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('|') && line.endsWith('|')) {
          if (!inTable) {
            inTable = true;
            tableHtml += '<thead class="bg-slate-100 text-slate-700 font-bold"><tr>';
            const headers = line.split('|').filter(c => c.trim() !== '');
            headers.forEach(h => {
              tableHtml += `<th class="px-3 py-2 border-b border-slate-200">${h.trim()}</th>`;
            });
            tableHtml += '</tr></thead><tbody class="divide-y divide-slate-100">';
            // Skip the next separator row if exists
            if (i + 1 < lines.length && lines[i + 1].includes('---')) {
              i++;
            }
          } else {
            tableHtml += '<tr class="hover:bg-slate-50 transition">';
            const cells = line.split('|').filter(c => c.trim() !== '');
            cells.forEach(c => {
              tableHtml += `<td class="px-3 py-2 text-slate-600">${c.trim()}</td>`;
            });
            tableHtml += '</tr>';
          }
        } else {
          if (inTable) {
            inTable = false;
            tableHtml += '</tbody></table></div>';
            newLines.push(tableHtml);
            tableHtml = '<div class="overflow-x-auto my-3"><table class="min-w-full text-xs text-left border border-slate-200 rounded-xl overflow-hidden">';
          }
          newLines.push(line);
        }
      }
      if (inTable) {
        tableHtml += '</tbody></table></div>';
        newLines.push(tableHtml);
      }
      formatted = newLines.join('\n');
    }

    // Format headers
    formatted = formatted.replace(/^#### (.*$)/gim, '<h5 class="text-sm font-bold text-slate-800 mt-3 mb-1">$1</h5>');
    formatted = formatted.replace(/^### (.*$)/gim, '<h4 class="text-base font-bold text-blue-900 mt-4 mb-2 flex items-center gap-2"><span class="w-1.5 h-4 bg-blue-600 rounded-full inline-block"></span>$1</h4>');
    // Format bullet points
    formatted = formatted.replace(/^\s*-\s+(.*$)/gim, '<li class="text-xs text-slate-600 ml-4 list-disc mb-1">$1</li>');
    // Format numbered points
    formatted = formatted.replace(/^\s*([0-9]+)\.\s+(.*$)/gim, '<li class="text-xs text-slate-600 ml-4 list-decimal mb-1 font-medium"><span class="text-slate-800 font-bold">$2</span></li>');
    // Format line breaks
    formatted = formatted.replace(/\n\n/g, '<div class="h-2"></div>');

    return formatted;
  },

  renderTopics() {
    const container = document.getElementById('manualTopicsContainer');
    if (!container || typeof ManualData === 'undefined') return;

    let filtered = ManualData.topics;

    if (this.currentCategory !== 'all') {
      filtered = filtered.filter(t => t.category === this.currentCategory);
    }

    if (this.searchQuery) {
      const q = this.searchQuery;
      filtered = filtered.filter(t => {
        const inTitle = t.title.toLowerCase().includes(q);
        const inSummary = t.summary.toLowerCase().includes(q);
        const inKeywords = t.keywords && t.keywords.some(k => k.toLowerCase().includes(q));
        const inContent = t.content.toLowerCase().includes(q);
        return inTitle || inSummary || inKeywords || inContent;
      });
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="bg-white rounded-3xl p-12 text-center border border-slate-200 shadow-sm">
          <div class="text-5xl mb-3">🔍</div>
          <h3 class="text-lg font-bold text-slate-700 mb-1">ไม่พบคู่มือที่ตรงกับคำค้นหา</h3>
          <p class="text-xs text-slate-400 mb-4">ลองใช้คำค้นหาอื่น เช่น "บิล", "ชำระเงิน", "สแกน", "โอนย้าย", หรือ "สำรอง"</p>
          <button onclick="ManualModule.clearSearch()" class="px-4 py-2 rounded-2xl bg-blue-50 text-blue-600 font-bold text-xs hover:bg-blue-100 transition cursor-pointer">
            ล้างคำค้นหา
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(t => `
      <article id="manual_topic_${t.id}" class="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/80 shadow-sm hover:shadow-md transition scroll-mt-20">
        <div class="flex items-center justify-between gap-3 mb-3 border-b border-slate-100 pb-3">
          <div class="flex items-center gap-3">
            <span class="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center text-xl shrink-0">
              ${t.icon}
            </span>
            <div>
              <span class="text-[10px] font-bold tracking-wider text-blue-600 uppercase bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                ${t.category}
              </span>
              <h3 class="text-lg font-black text-slate-900 mt-1">${t.title}</h3>
            </div>
          </div>
          <button type="button" onclick="navigator.clipboard.writeText(window.location.origin + window.location.pathname + '#manual_' + '${t.id}'); UI.showToast('คัดลอกลิงก์หัวข้อแล้ว', 'success');"
                  title="คัดลอกลิงก์หัวข้อนี้" class="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer text-xs">
            🔗
          </button>
        </div>
        
        <p class="text-xs font-semibold text-slate-500 mb-4 bg-slate-50 p-3 rounded-2xl border border-slate-100">
          💡 ${t.summary}
        </p>

        <div class="manual-content text-slate-700 leading-relaxed space-y-2 text-xs">
          ${this.formatContent(t.content)}
        </div>
      </article>
    `).join('');
  },

  scrollToTopic(topicId) {
    const el = document.getElementById(`manual_topic_${topicId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  printManual() {
    window.print();
  },

  goBack() {
    if (Router.previousView && Router.previousView !== 'manual') {
      Router.navigate(Router.previousView);
    } else {
      Router.navigate(Auth.isLoggedIn() ? 'launcher' : 'login');
    }
  }
};

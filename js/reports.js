/* ---------------- Charts ---------------- */
function getCssVar(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function renderCharts(mIdx,y,metrics,monthAgg,trendRosterArg){
  if(typeof Chart === "undefined") return;
  const trendCanvas = document.getElementById("trendChart");
  const trendRosterList = trendRosterArg || state.roster;
  if(trendCanvas && trendRosterList.length && metrics.length){
    if(!trendAgentId || !trendRosterList.some(a=>a.empId===trendAgentId)) trendAgentId = trendRosterList[0].empId;
    if(!trendMetricField || !metrics.some(m=>m.field===trendMetricField)) trendMetricField = metrics[0].field;
    const nd = daysInMonth(mIdx,y);
    const labels = [], data = [];
    for(let d=1; d<=nd; d++){
      const iso = dateKey(y,mIdx,d);
      const rec = getDaily(trendAgentId, iso);
      labels.push(String(d));
      const v = rec[trendMetricField];
      data.push(v!==""&&v!=null ? Number(v) : null);
    }
    const metricObj = metrics.find(m=>m.field===trendMetricField);
    if(trendChartInst){ try{ trendChartInst.destroy(); }catch(e){} }
    trendChartInst = new Chart(trendCanvas, {
      type:"line",
      data:{labels, datasets:[{label:metricObj?metricObj.name:"Value", data, borderColor:getCssVar('--accent'), backgroundColor:"transparent", spanGaps:true, tension:0.3, pointRadius:3, pointBackgroundColor:getCssVar('--accent')}]},
      options:{responsive:true,
        plugins:{legend:{display:false}, tooltip:{mode:"index", intersect:false}},
        scales:{
          x:{ticks:{color:getCssVar('--text-muted')}, grid:{color:getCssVar('--border')}},
          y:{ticks:{color:getCssVar('--text-muted')}, grid:{color:getCssVar('--border')}}
        }
      }
    });
  }
  const compareCanvas = document.getElementById("compareChart");
  if(compareCanvas && monthAgg.length && metrics.length){
    if(!compareMetricField || !metrics.some(m=>m.field===compareMetricField)) compareMetricField = metrics[0].field;
    const cMetricObj = metrics.find(m=>m.field===compareMetricField);
    const cLabels = monthAgg.map(a=>a.name);
    const cData = monthAgg.map(a=> a.values[compareMetricField]!=null ? Number(a.values[compareMetricField].toFixed(1)) : 0);
    const colors = monthAgg.map(a=>{
      const v = a.values[compareMetricField];
      const c = v!=null ? metricColor(cMetricObj, v) : null;
      return c==="green"?getCssVar('--green'):c==="yellow"?getCssVar('--yellow'):c==="red"?getCssVar('--red'):getCssVar('--text-dim');
    });
    if(compareChartInst){ try{ compareChartInst.destroy(); }catch(e){} }
    compareChartInst = new Chart(compareCanvas, {
      type:"bar",
      data:{labels:cLabels, datasets:[{label:cMetricObj?cMetricObj.name:"Value", data:cData, backgroundColor:colors, borderRadius:4}]},
      options:{responsive:true,
        plugins:{legend:{display:false}},
        scales:{
          x:{ticks:{color:getCssVar('--text-muted')}, grid:{display:false}},
          y:{ticks:{color:getCssVar('--text-muted')}, grid:{color:getCssVar('--border')}}
        }
      }
    });
  }
}

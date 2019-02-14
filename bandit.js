const {
  map,
  times,
  filter,
  isEmpty,
  sample,
  get,
  set,
  maxBy,
  reduce,
  each,
  constant,
  sum,
  flow,
  range,
  join,
  getOr,
  contains,
  identity,
  pullAt
} = _;

const mapWithIndex = map.convert({ cap: false });

function defaultData() {
  return {
    epsilon: 0.1,
    algorithm: "eGreedy",
    minVisits: 10,
    iterations: 10000,
    currentIteration: 0,
    epsilonF: 7,
    rewardDelayRangeSeconds: [1, 10],
    total: 1000,
    bet: 1,
    winPayout: 2,
    canvas: {
      height: 500,
      width: 500
    },
    variants: mapWithIndex((payout, index) => ({
      variantName: `V${index + 1}`,
      payout,
      bandit: {
        pulls: 0,
        rewards: 0
      }
    }))([0.1, 0.3, 0.7, 0.9]),
    outstandingDelayedRewards: 0,
    asyncOperations: []
  };
}

let data = defaultData();

function load() {
  render(data);
}

function inputChange(index, value) {
  data.variants[index].payout = parseFloat(value);
}

function resetBandit() {
  data.total = 1000;
  each(variant => (variant.bandit = { pulls: 0, rewards: 0 }))(data.variants);
}

function runInSeconds(seconds, f) {
  return setTimeout(f, seconds * 1000);
}

function render({ variants, total }) {
  const {
    canvas: { width: canvasWidth, height: canvasHeight }
  } = data;
  const columnWidth = canvasWidth / variants.length;

  const canvas = d3
    .select("#canvas")
    .style("width", canvasWidth)
    .style("height", canvasHeight)
    .style("border", "1px solid black");

  d3.select("#variantsInputs")
    .selectAll("div.input_group")
    .data(variants)
    .enter()
    .append("div")
    .attr("class", "input_group")
    .html(
      (a, i) =>
        `<div><label>V${i + 1}: <input type="number" value="${
          a.payout
        }" onchange="inputChange(${i}, this.value)"/></label></div>`
    );
  //<button onclick="removeVariantAt(${i})">del</button>

  d3.select("#outputs .iteration").html(
    () =>
      `Iteration: <strong>${data.currentIteration}/${data.iterations}</strong>`
  );

  d3.select("#outputs .total").html(() => `Total: <strong>$${total}<strong>`);
  const totalPulls = sumPulls(variants);
  const bestPerformingVariant = findBestPerformingVariant(variants);

  function bindInputToDataWithParser(dataPath, parseInputData, inputId) {
    const input = document.getElementById(inputId);
    input.value = get(dataPath)(data);
    input.onchange = ev => {
      data = set(dataPath, parseInputData(ev.target.value))(data);
    };
  }

  function bindInputToData(dataPath, inputId) {
    return bindInputToDataWithParser(dataPath, identity, inputId);
  }

  function bindFloatInputToData(dataPath, inputId) {
    return bindInputToDataWithParser(dataPath, parseFloat, inputId);
  }

  function bindIntInputToData(dataPath, inputId) {
    return bindInputToDataWithParser(
      dataPath,
      str => parseInt(str, 10),
      inputId
    );
  }

  bindFloatInputToData("epsilon", "inputEpsilon");
  bindInputToData("rewardDelayRangeSeconds[0]", "inputRewardDelayMin");
  bindInputToData("rewardDelayRangeSeconds[1]", "inputRewardDelayMax");
  bindInputToData("epsilonF", "inputEpsilonDecayFactor");
  bindIntInputToData("iterations", "inputIterations");

  if (bestPerformingVariant && bestPerformingVariant.bandit) {
    const bestExpectedValue = variantExpectedValue(bestPerformingVariant);
    const regret = totalPulls - findBestVariant(variants).bandit.pulls;

    d3.select("#outputs .regretPulls").html(
      () =>
        `Regret (pulls): <strong>${regret} (${Math.round(
          (regret / totalPulls) * 100,
          2
        )}%)<strong>`
    );

    d3.select("#outputs .totalPulls").html(
      () => `Total (pulls): <strong>${totalPulls}<strong>`
    );
  }

  d3.select("#outputs .variants").html(() =>
    flow(
      map(
        v =>
          `<div><strong>${v.variantName}</strong>  pulls: <strong>${
            v.bandit.pulls
          }</strong>, rewards: <strong>${
            v.bandit.rewards
          }</strong>, ev: <strong>${variantExpectedValue(v).toFixed(
            3
          )}</strong></div>`
      ),
      join("")
    )(variants)
  );

  d3.select("#outputs .outstandingDelayedRewards").html(
    () =>
      `<div>Outstanding rewards: <strong>${
        data.outstandingDelayedRewards
      }</strong></div>`
  );

  d3.select("#outputs .epsilon").html(
    () =>
      `<div>Epsilon(<i>${data.algorithm}</i>): <strong>${calculateEpsilon(
        data.algorithm,
        data.variants
      ).toFixed(3)}</strong></div>`
  );

  const t = canvas.selectAll("rect.column").data(variants);

  t.exit().remove();

  t.enter()
    .append("rect")
    .attr("class", "column")
    .attr("width", columnWidth)
    .attr("x", (d, i) => i * columnWidth)
    .attr("y", 0)
    .attr("height", 0)
    .style("fill", "blue");

  t.attr("height", d => canvasHeight * (d.bandit.pulls / totalPulls) || 0);
  t.attr("width", d => columnWidth);
  t.attr(
    "y",
    d => canvasHeight - canvasHeight * (d.bandit.pulls / totalPulls) || 0
  );
  t.attr("x", (d, i) => i * columnWidth);

  const buttonRun = document.getElementById("buttonRun");
  buttonRun.disabled = data.outstandingDelayedRewards > 0;
  buttonRun.innerText =
    data.outstandingDelayedRewards > 0 ? "Running..." : "Run";
}

const variantExpectedValue = variant =>
  variant.bandit.rewards / variant.bandit.pulls;

const findBestPerformingVariant = maxBy(variantExpectedValue);
const findBestVariant = maxBy(get("payout"));

const sumPulls = flow(
  map(get("bandit.pulls")),
  sum
);

const sumRewards = flow(
  map(get("bandit.rewards")),
  sum
);

function incrementBanditCounter(counterName, variant) {
  const path = ["bandit", counterName];
  variant.bandit[counterName] = get(path)(variant) + 1;
}

function changeAlgorithmType(type) {
  data.algorithm = type;
}

function selectVariant(variants) {
  const { algorithm, minVisits } = data;

  const variantsBelowMinVisits = filter(
    variant => variant.bandit.pulls < minVisits
  )(variants);

  if (!isEmpty(variantsBelowMinVisits)) {
    return sample(variantsBelowMinVisits);
  }

  const variantsWithRewards = filter(variant => get("bandit.rewards")(variant))(
    variants
  );

  const epsilonAlgorithms = [
    "eGreedy",
    "eGreedyDecayPulls",
    "eGreedyDecayRewards"
  ];

  if (contains(algorithm)(epsilonAlgorithms)) {
    const epsilon = calculateEpsilon(algorithm, variants);

    const isExplore = Math.random() < epsilon;

    if (isExplore || isEmpty(variantsWithRewards)) {
      return sample(variants);
    }

    return findBestPerformingVariant(variants);
  }
}

function calculateEpsilon(algorithm, variants) {
  if (algorithm === "eGreedy") {
    return data.epsilon;
  }

  const totalVariants = variants.length;
  const variantMultiplier = data.epsilonF;
  if (algorithm === "eGreedyDecayRewards") {
    const totalRewards = flow(
      map(getOr(0, "bandit.rewards")),
      sum
    )(variants);
    return (
      (totalVariants * variantMultiplier) /
      (totalRewards + totalVariants * variantMultiplier)
    );
  }

  if (algorithm === "eGreedyDecayPulls") {
    const totalPulls = flow(
      map(getOr(0, "bandit.pulls")),
      sum
    )(variants);
    return (
      (totalVariants * variantMultiplier) /
      (totalPulls + totalVariants * variantMultiplier)
    );
  }
}

function visitVariant() {
  const { variants, bet, winPayout } = data;
  const variant = selectVariant(variants);

  const { payout } = variant;
  const isWin = Math.random() < payout;

  data.total = data.total - bet;
  incrementBanditCounter("pulls", variant);

  if (isWin) {
    data.total = data.total + winPayout;
    // incrementBanditCounter('rewards', variant);
    const [delayMin, delayMax] = data.rewardDelayRangeSeconds;
    const delay = sample(range(delayMin, delayMax + 1));
    data.outstandingDelayedRewards += 1;
    render(data);
    const asyncId = runInSeconds(delay, () => {
      incrementBanditCounter("rewards", variant);
      data.outstandingDelayedRewards -= 1;
      render(data);
    });

    data.asyncOperations.push(asyncId);
  }
}

function work(totalIterations, iteration) {
  if (iteration >= totalIterations) return;

  const iterationVisits = 10;

  data.currentIteration = iteration + iterationVisits;

  times(visitVariant)(iterationVisits);

  render(data);

  requestAnimationFrame(() =>
    work(totalIterations, iteration + iterationVisits)
  );
}

function run() {
  resetBandit();

  requestAnimationFrame(() => work(data.iterations, 0));
}

function addVariant() {
  data.variants.push({
    variantName: `V${data.variants.length + 1}`,
    payout: 0.5,
    bandit: {
      pulls: 0,
      rewards: 0
    }
  });

  render(data);
}

function removeVariantAt(index) {
  data.variants = pullAt([index], data.variants);

  render(data);
}

(function () {
  const REGIONS = [
    {
      name: "Auvergne-Rhône-Alpes",
      departments: [
        ["01", "Ain"], ["03", "Allier"], ["07", "Ardèche"], ["15", "Cantal"],
        ["26", "Drôme"], ["38", "Isère"], ["42", "Loire"], ["43", "Haute-Loire"],
        ["63", "Puy-de-Dôme"], ["69", "Rhône"], ["73", "Savoie"], ["74", "Haute-Savoie"]
      ]
    },
    {
      name: "Bourgogne-Franche-Comté",
      departments: [
        ["21", "Côte-d'Or"], ["25", "Doubs"], ["39", "Jura"], ["58", "Nièvre"],
        ["70", "Haute-Saône"], ["71", "Saône-et-Loire"], ["89", "Yonne"], ["90", "Territoire de Belfort"]
      ]
    },
    {
      name: "Bretagne",
      departments: [["22", "Côtes-d'Armor"], ["29", "Finistère"], ["35", "Ille-et-Vilaine"], ["56", "Morbihan"]]
    },
    {
      name: "Centre-Val de Loire",
      departments: [["18", "Cher"], ["28", "Eure-et-Loir"], ["36", "Indre"], ["37", "Indre-et-Loire"], ["41", "Loir-et-Cher"], ["45", "Loiret"]]
    },
    {
      name: "Corse",
      departments: [["2A", "Corse-du-Sud"], ["2B", "Haute-Corse"]]
    },
    {
      name: "Grand Est",
      departments: [
        ["08", "Ardennes"], ["10", "Aube"], ["51", "Marne"], ["52", "Haute-Marne"],
        ["54", "Meurthe-et-Moselle"], ["55", "Meuse"], ["57", "Moselle"], ["67", "Bas-Rhin"],
        ["68", "Haut-Rhin"], ["88", "Vosges"]
      ]
    },
    {
      name: "Hauts-de-France",
      departments: [["02", "Aisne"], ["59", "Nord"], ["60", "Oise"], ["62", "Pas-de-Calais"], ["80", "Somme"]]
    },
    {
      name: "Île-de-France",
      departments: [["75", "Paris"], ["77", "Seine-et-Marne"], ["78", "Yvelines"], ["91", "Essonne"], ["92", "Hauts-de-Seine"], ["93", "Seine-Saint-Denis"], ["94", "Val-de-Marne"], ["95", "Val-d'Oise"]]
    },
    {
      name: "Normandie",
      departments: [["14", "Calvados"], ["27", "Eure"], ["50", "Manche"], ["61", "Orne"], ["76", "Seine-Maritime"]]
    },
    {
      name: "Nouvelle-Aquitaine",
      departments: [
        ["16", "Charente"], ["17", "Charente-Maritime"], ["19", "Corrèze"], ["23", "Creuse"],
        ["24", "Dordogne"], ["33", "Gironde"], ["40", "Landes"], ["47", "Lot-et-Garonne"],
        ["64", "Pyrénées-Atlantiques"], ["79", "Deux-Sèvres"], ["86", "Vienne"], ["87", "Haute-Vienne"]
      ]
    },
    {
      name: "Occitanie",
      departments: [
        ["09", "Ariège"], ["11", "Aude"], ["12", "Aveyron"], ["30", "Gard"],
        ["31", "Haute-Garonne"], ["32", "Gers"], ["34", "Hérault"], ["46", "Lot"],
        ["48", "Lozère"], ["65", "Hautes-Pyrénées"], ["66", "Pyrénées-Orientales"], ["81", "Tarn"], ["82", "Tarn-et-Garonne"]
      ]
    },
    {
      name: "Pays de la Loire",
      departments: [["44", "Loire-Atlantique"], ["49", "Maine-et-Loire"], ["53", "Mayenne"], ["72", "Sarthe"], ["85", "Vendée"]]
    },
    {
      name: "Provence-Alpes-Côte d'Azur",
      departments: [["04", "Alpes-de-Haute-Provence"], ["05", "Hautes-Alpes"], ["06", "Alpes-Maritimes"], ["13", "Bouches-du-Rhône"], ["83", "Var"], ["84", "Vaucluse"]]
    },
    { name: "Guadeloupe", departments: [["971", "Guadeloupe"]] },
    { name: "Martinique", departments: [["972", "Martinique"]] },
    { name: "Guyane", departments: [["973", "Guyane"]] },
    { name: "La Réunion", departments: [["974", "La Réunion"]] },
    { name: "Mayotte", departments: [["976", "Mayotte"]] }
  ];

  function departmentValue(department) {
    return `${department[0]} - ${department[1]}`;
  }

  function getAllDepartments() {
    return REGIONS.flatMap(region => region.departments.map(department => ({
      region: region.name,
      code: department[0],
      name: department[1],
      value: departmentValue(department)
    })));
  }

  function setOptions(select, options, placeholder, valueKey = "value", labelKey = "label") {
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = "";

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder || "Sélectionner";
    select.appendChild(placeholderOption);

    options.forEach(option => {
      const opt = document.createElement("option");
      opt.value = option[valueKey];
      opt.textContent = option[labelKey];
      if (option.dataset) {
        Object.entries(option.dataset).forEach(([key, value]) => {
          opt.dataset[key] = value;
        });
      }
      select.appendChild(opt);
    });

    if (currentValue && Array.from(select.options).some(option => option.value === currentValue)) {
      select.value = currentValue;
    }
  }

  function populateRegions(select, placeholder) {
    setOptions(
      select,
      REGIONS.map(region => ({ value: region.name, label: region.name })),
      placeholder || "Sélectionner une région"
    );
  }

  function populateDepartments(select, regionName, placeholder, includeAllWhenNoRegion) {
    const region = REGIONS.find(item => item.name === regionName);
    const source = region
      ? region.departments.map(department => ({
          value: departmentValue(department),
          label: `${department[0]} - ${department[1]}`,
          dataset: { region: region.name, code: department[0], name: department[1] }
        }))
      : (includeAllWhenNoRegion ? getAllDepartments().map(department => ({
          value: department.value,
          label: `${department.code} - ${department.name}`,
          dataset: { region: department.region, code: department.code, name: department.name }
        })) : []);

    setOptions(select, source, placeholder || "Sélectionner un département");
  }

  function inferRegionFromDepartment(departmentValueToFind) {
    if (!departmentValueToFind) return "";
    const department = getAllDepartments().find(item => item.value === departmentValueToFind || item.code === departmentValueToFind);
    return department?.region || "";
  }

  function setupRegionDepartment(options) {
    const regionSelect = document.getElementById(options.regionId);
    const departmentSelect = document.getElementById(options.departmentId);
    if (!regionSelect || !departmentSelect) return;

    populateRegions(regionSelect, options.regionPlaceholder);
    populateDepartments(
      departmentSelect,
      regionSelect.value,
      options.departmentPlaceholder,
      options.includeAllDepartmentsWhenNoRegion !== false
    );

    regionSelect.addEventListener("change", () => {
      populateDepartments(
        departmentSelect,
        regionSelect.value,
        options.departmentPlaceholder,
        options.includeAllDepartmentsWhenNoRegion !== false
      );
      if (typeof options.onChange === "function") options.onChange();
    });

    departmentSelect.addEventListener("change", () => {
      const selectedDepartment = departmentSelect.value;
      const inferredRegion = inferRegionFromDepartment(selectedDepartment);
      if (inferredRegion && !regionSelect.value) {
        regionSelect.value = inferredRegion;
        populateDepartments(departmentSelect, inferredRegion, options.departmentPlaceholder, true);
        departmentSelect.value = selectedDepartment;
      }
      if (typeof options.onChange === "function") options.onChange();
    });
  }

  function setupPostalCode(id) {
    const input = document.getElementById(id);
    if (!input) return;
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("maxlength", "5");
    input.setAttribute("pattern", "[0-9]{5}");
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D+/g, "").slice(0, 5);
    });
  }

  window.VP_FRANCE_LOCATION = {
    regions: REGIONS,
    departments: getAllDepartments(),
    setupRegionDepartment,
    setupPostalCode,
    populateRegions,
    populateDepartments,
    inferRegionFromDepartment
  };
})();

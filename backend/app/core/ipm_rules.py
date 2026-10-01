from typing import Dict, Any, Tuple
from enum import Enum

class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

class IPMAdvisor:
    """
    Integrated Pest Management (IPM) rule engine for Corn Pests & Rodents:
    - Asian-Corn-Borer (Ostrinia furnacalis / Penggerek Batang Jagung)
    - Bollworm (Helicoverpa armigera / Ulat Tongkol Jagung)
    - Fall-Armyworm (Spodoptera frugiperda / Ulat Grayak Jagung)
    - Rat (Rattus spp. / Hama Tikus Ladang & Sawah)
    """
    
    IPM_PROFILES: Dict[str, Dict[str, Any]] = {
        "Asian-Corn-Borer": {
            "name_id": "Penggerek Batang Jagung",
            "warning": 2,
            "critical": 5,
            "action_warning": "Lepaskan parasitoid telur Trichogramma spp. Periksa pangkal batang untuk lubang gerekan awal.",
            "action_critical": "Aplikasi insektisida butiran (Bacillus thuringiensis / klorantraniliprol) ke pucuk/batang sebelum larva masuk ke dalam jaringan batang."
        },
        "Bollworm": {
            "name_id": "Ulat Tongkol Jagung",
            "warning": 2,
            "critical": 5,
            "action_warning": "Pantau tongkol muda dan rambut jagung (silking). Pasang perangkap feromon.",
            "action_critical": "Semprotkan bio-insektisida Bt atau spinosad langsung ke area rambut tongkol jagung segar sebelum ulat masuk ke dalam klobot."
        },
        "Fall-Armyworm": {
            "name_id": "Ulat Grayak Jagung",
            "warning": 2,
            "critical": 6,
            "action_warning": "Amati daun pupus (whorl) jagung. Lepaskan musuh alami atau parasitoid telur.",
            "action_critical": "Aplikasi terarah emamektin benzoat atau Bt kurstaki ke dalam corong daun pupus jagung."
        },
        "Rat": {
            "name_id": "Hama Tikus Ladang / Sawah",
            "warning": 1,
            "critical": 3,
            "action_warning": "Lakukan sanitasi pematang dan sarang tikus di sekitar kebun. Pasang pagar perangkap sistem bubu (TBS/LTBS).",
            "action_critical": "Lakukan gropyokan massal, pasang rumah burung hantu (Tyto alba), atau umpan rodentisida antikoagulan di jalur aktif tikus."
        }
    }
    
    @classmethod
    def evaluate(cls, species_counts: Dict[str, int]) -> Tuple[RiskLevel, str, Dict[str, Any]]:
        if not species_counts or sum(species_counts.values()) == 0:
            return (
                RiskLevel.LOW,
                "Tanaman terpantau bersih dari hama sasaran. Lanjutkan pemantauan rutin.",
                {"highest_risk_species": None, "saturation_pct": 0.0}
            )
            
        max_severity = 0
        highest_risk_species = None
        primary_action = "Lanjutkan pemantauan rutin pada perangkap/lahan jagung."
        
        species_risks = {}
        
        for species, count in species_counts.items():
            profile = cls.IPM_PROFILES.get(species)
            if not profile:
                continue
                
            warn_th = profile["warning"]
            crit_th = profile["critical"]
            
            if count >= crit_th:
                sev = 3
                risk = RiskLevel.CRITICAL
                action = profile["action_critical"]
            elif count >= warn_th:
                sev = 2
                risk = RiskLevel.HIGH
                action = profile["action_warning"]
            elif count > 0:
                sev = 1
                risk = RiskLevel.MEDIUM
                action = f"Ditemukan {count} ekor {profile['name_id']}. Lakukan pemantauan intensif."
            else:
                sev = 0
                risk = RiskLevel.LOW
                action = "Tidak terdeteksi."
                
            species_risks[species] = {
                "count": count,
                "risk_level": risk.value,
                "action": action,
                "common_name": profile["name_id"]
            }
            
            if sev > max_severity:
                max_severity = sev
                highest_risk_species = species
                primary_action = action
                
        severity_map = {
            0: RiskLevel.LOW,
            1: RiskLevel.MEDIUM,
            2: RiskLevel.HIGH,
            3: RiskLevel.CRITICAL
        }
        
        overall_risk = severity_map[max_severity]
        total_pests = sum(species_counts.values())
        saturation_pct = min(100.0, round((total_pests / 20.0) * 100, 1))
        
        metadata = {
            "highest_risk_species": highest_risk_species,
            "saturation_pct": saturation_pct,
            "species_breakdown": species_risks
        }
        
        return overall_risk, primary_action, metadata

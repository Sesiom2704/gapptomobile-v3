from typing import Optional
from pydantic import BaseModel, ConfigDict

class AuxBase(BaseModel):
    nombre: str

class AuxCreate(AuxBase):
    pass

class AuxUpdate(BaseModel):
    nombre: Optional[str] = None

class AuxOut(AuxBase):
    id: str
    model_config = ConfigDict(from_attributes=True)

# TipoGasto necesita extras
class TipoGastoCreate(BaseModel):
    nombre: str
    rama_id: str
    segmento_id: Optional[str] = None

class TipoGastoUpdate(BaseModel):
    nombre: Optional[str] = None
    rama_id: Optional[str] = None
    segmento_id: Optional[str] = None

class TipoGastoOut(BaseModel):
    id: str
    nombre: str
    rama_id: str
    segmento_id: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)

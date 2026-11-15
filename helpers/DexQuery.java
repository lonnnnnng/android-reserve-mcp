import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;
import com.google.gson.*;
import com.android.tools.smali.dexlib2.dexbacked.*;
import com.android.tools.smali.dexlib2.iface.*;
import com.android.tools.smali.dexlib2.iface.instruction.*;
import com.android.tools.smali.dexlib2.iface.reference.*;
import jadx.api.*;

/** @author long */
public class DexQuery {
  static final int DEX_BYTES = 128 * 1024 * 1024, OUTPUT_BYTES = 16 * 1024 * 1024;
  static final Gson JSON = new Gson();
  static long retained, totalDex, instructions, visitedClasses, visitedMethods;
  static boolean partial, queryPrefix, indexMethods, exportDex;
  static final List<Object> classes = new ArrayList<>(), methods = new ArrayList<>(), references = new ArrayList<>();
  static final List<Object> dexes = new ArrayList<>(), targetClasses = new ArrayList<>(), targetMethods = new ArrayList<>();
  static final List<String> warnings = new ArrayList<>();
  static Path output;
  static Map<String,Object> sourceIdentity;
  static String action, query, owner, methodName, descriptor, definitionId;
  static Set<String> extraClasses;

  static String text(JsonObject object, String key) { return object.has(key) && !object.get(key).isJsonNull() ? object.get(key).getAsString() : ""; }
  static String hash(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
  static String fileHash(Path path) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream input = Files.newInputStream(path)) { byte[] buffer = new byte[65536]; int size; while ((size = input.read(buffer)) >= 0) digest.update(buffer, 0, size); }
    return HexFormat.of().formatHex(digest.digest());
  }
  static void incomplete(String message) { partial = true; if (warnings.size() < 100) warnings.add(message); }
  static boolean keep(List<Object> output, Map<String,Object> row) {
    long size = JSON.toJson(row).getBytes(StandardCharsets.UTF_8).length;
    if (output.size() >= 20000 || retained + size > OUTPUT_BYTES - 16384) { incomplete("结果数量或16MiB报告预算耗尽"); return false; }
    retained += size; output.add(row); return true;
  }
  static String prototype(MethodReference method) {
    StringBuilder value = new StringBuilder("(");
    for (CharSequence type : method.getParameterTypes()) value.append(type);
    return value.append(')').append(method.getReturnType()).toString();
  }
  static String id(MethodReference method) { return method.getDefiningClass() + "->" + method.getName() + prototype(method); }
  static String className(String type) { return type.substring(1, type.length() - 1).replace('/', '.'); }
  static boolean selectedClass(String name) { return action.equals("classes") ? (queryPrefix ? name.startsWith(query) : name.contains(query)) || extraClasses.contains(name) : name.equals(owner); }
  static Map<String,Object> identity(JsonObject input, String inputHash, String entry, int zipIndex, String dexHash, int classIndex) {
    Map<String,Object> value = new LinkedHashMap<>();
    value.put("inputSha256", inputHash); value.put("source", text(input,"source")); value.put("dexEntry", entry); value.put("zipIndex", zipIndex);
    value.put("dexSha256", dexHash); value.put("classIndex", classIndex); return value;
  }
  static Map<String,Object> methodRow(DexBackedMethod method, Map<String,Object> parent, String group, int encodedIndex) throws Exception {
    Map<String,Object> origin = new LinkedHashMap<>(parent); origin.put("methodIndex", method.getMethodIndex()); origin.put("methodGroup", group); origin.put("encodedIndex", encodedIndex);
    Map<String,Object> row = new LinkedHashMap<>(); row.put("className", className(method.getDefiningClass())); row.put("methodName", method.getName());
    row.put("descriptor", prototype(method)); row.put("methodId", id(method)); row.put("accessFlags", method.getAccessFlags());
    row.put("identity", origin); row.put("definitionId", hash(JSON.toJson(origin).getBytes(StandardCharsets.UTF_8)));
    row.put("classDefinitionId",hash(JSON.toJson(parent).getBytes(StandardCharsets.UTF_8)));
    row.put("hasCode", method.getImplementation() != null); return row;
  }
  static boolean selectedMethod(Map<String,Object> row) {
    return (methodName.isEmpty() || methodName.equals(row.get("methodName"))) && (descriptor.isEmpty() || descriptor.equals(row.get("descriptor"))) &&
      (definitionId.isEmpty() || definitionId.equals(row.get("definitionId")));
  }
  static boolean symbolicMethod(Map<String,Object> row) {
    return (methodName.isEmpty() || methodName.equals(row.get("methodName"))) && (descriptor.isEmpty() || descriptor.equals(row.get("descriptor")));
  }
  static void candidate(List<Object> values, Map<String,Object> row) {
    if (values.size() >= 20000) incomplete("2万条目标定义候选预算耗尽"); else values.add(row);
  }
  static void visitReferences(DexBackedMethod method, Map<String,Object> source) {
    MethodImplementation body = method.getImplementation(); if (body == null) return;
    int offset = 0;
    for (Instruction instruction : body.getInstructions()) {
      if (++instructions > 2000000) { incomplete("200万条DEX指令预算耗尽，后续引用未知"); return; }
      if (Thread.currentThread().isInterrupted()) throw new IllegalStateException("分析已取消");
      if (instruction instanceof ReferenceInstruction indexed) {
        Reference reference = indexed.getReference(); String kind = null; Map<String,Object> target = new LinkedHashMap<>();
        if (reference instanceof MethodReference call) {
          target.put("className", call.getDefiningClass().startsWith("L") ? className(call.getDefiningClass()) : call.getDefiningClass()); target.put("methodName", call.getName()); target.put("descriptor", prototype(call)); target.put("methodId", id(call));
          if (owner.equals(target.get("className")) && (methodName.isEmpty() || methodName.equals(call.getName())) && (descriptor.isEmpty() || descriptor.equals(prototype(call)))) kind = "method-reference";
          if (instruction instanceof DualReferenceInstruction dual && dual.getReference2() instanceof MethodProtoReference proto) target.put("callsitePrototype", "(" + String.join("", proto.getParameterTypes()) + ")" + proto.getReturnType());
        } else if (methodName.isEmpty() && reference instanceof TypeReference type && type.getType().equals("L" + owner.replace('.', '/') + ";")) {
          kind = "type-reference"; target.put("className", owner);
        } else if (methodName.isEmpty() && reference instanceof FieldReference field && field.getDefiningClass().equals("L" + owner.replace('.', '/') + ";")) {
          kind = "field-reference"; target.put("className", owner); target.put("fieldName", field.getName()); target.put("fieldType", field.getType());
        }
        if (kind != null) {
          Map<String,Object> row = new LinkedHashMap<>(); row.put("kind", kind); row.put("sourceMethod", source); row.put("target", target); row.put("dexOffset", offset);
          row.put("offsetUnit", "16-bit-code-unit"); row.put("opcode", instruction.getOpcode().name); row.put("dispatch", instruction.getOpcode().name.contains("polymorphic") ? "polymorphic" : "declared-reference-not-runtime-dispatch");
          keep(references, row);
        }
      }
      offset += instruction.getCodeUnits();
    }
  }
  static void inspectDex(byte[] bytes, JsonObject input, String inputHash, String entry, int zipIndex) throws Exception {
    if (bytes.length > DEX_BYTES || totalDex + bytes.length > 512L * 1024 * 1024) { incomplete("DEX成员或累计读取预算耗尽"); return; }
    totalDex += bytes.length; String dexHash = hash(bytes);
    DexBackedDexFile dex = new DexBackedDexFile(null, bytes);
    if (dex.supportsOptimizedOpcodes()) throw new IllegalArgumentException("不接受优化DEX/ODEX指令作为普通DEX");
    var definitions = dex.getClassSection();
    Map<String,Object> dexOrigin = identity(input,inputHash,entry,zipIndex,dexHash,-1); dexOrigin.remove("classIndex");
    dexOrigin.put("classes", definitions.size());dexOrigin.put("dexBytes",bytes.length);
    if (exportDex) {
      String exported = "metadata-dex-" + dexes.size() + ".dex";
      Files.write(output.getParent().resolve(exported), bytes); dexOrigin.put("artifact",exported);
    }
    dexes.add(dexOrigin);
    for (int index = 0; index < definitions.size(); index++) {
      if (++visitedClasses > 200000) { incomplete("20万类遍历预算耗尽"); return; }
      DexBackedClassDef cls = definitions.get(index); String name = className(cls.getType());
      Map<String,Object> origin = identity(input,inputHash,entry,zipIndex,dexHash,index);
      String classId = hash(JSON.toJson(origin).getBytes(StandardCharsets.UTF_8));
      Map<String,Object> classRow = new LinkedHashMap<>(); classRow.put("className",name); classRow.put("identity",origin); classRow.put("accessFlags",cls.getAccessFlags()); classRow.put("superClass",cls.getSuperclass()); classRow.put("definitionId",classId);
      if (name.equals(owner)) candidate(targetClasses,classRow);
      boolean classSelection = action.equals("class") || action.equals("references") && methodName.isEmpty();
      boolean chosen = selectedClass(name) && (!classSelection || definitionId.isEmpty() || definitionId.equals(classId));
      if (chosen) {
        keep(classes,classRow);
      }
      if (action.equals("classes") && (!indexMethods || !chosen)) continue;
      // long: false保留重复编码的方法引用；原始定义在JADX去重之前索引，跨DEX/分包同名不能冒充唯一方法。
      for (String group : List.of("direct","virtual")) {
        Iterable<? extends DexBackedMethod> collection = group.equals("direct") ? cls.getDirectMethods(false) : cls.getVirtualMethods(false); int encodedIndex = 0;
        for (DexBackedMethod method : collection) {
          if (++visitedMethods > 1000000) { incomplete("100万方法遍历预算耗尽"); return; }
          Map<String,Object> row = methodRow(method,origin,group,encodedIndex++);
          if (name.equals(owner) && symbolicMethod(row)) candidate(targetMethods,row);
          if (action.equals("classes") ? chosen : name.equals(owner) && (action.equals("class") ? chosen : selectedMethod(row))) keep(methods,row);
          if (action.equals("references") && instructions <= 2000000) visitReferences(method,row);
        }
      }
    }
  }
  static void inspectInput(JsonObject input) throws Exception {
    Path file = Path.of(text(input,"path")); String inputHash = fileHash(file);
    if (!inputHash.equals(text(input,"sha256"))) throw new IllegalArgumentException("输入快照SHA与配置不符");
    if (text(input,"kind").equals("dex")) { if(Files.size(file)>DEX_BYTES){incomplete("独立DEX超过128MiB");return;} inspectDex(Files.readAllBytes(file),input,inputHash,"<standalone-dex>",0); return; }
    try (ZipFile archive = new ZipFile(file.toFile())) {
      Map<String,Integer> names = new HashMap<>(); var directory = archive.entries(); int count = 0;
      while (directory.hasMoreElements()) { ZipEntry item = directory.nextElement(); if (++count > 20000) throw new IllegalArgumentException("APK目录超过2万项"); names.merge(item.getName(),1,Integer::sum); }
      directory = archive.entries(); int zipIndex = -1, found = 0;
      while (directory.hasMoreElements()) {
        ZipEntry item = directory.nextElement(); zipIndex++;
        if (!item.getName().matches("classes(?:[0-9]+)?\\.dex")) continue;
        found++;
        // long: ZipFile按名字取流无法证明重复条目的实际字节；拒绝猜选，保留目录位置并说明剩余未知。
        if (names.get(item.getName()) != 1) { incomplete("重复DEX成员名：" + item.getName()); continue; }
        if (item.getSize() < 0 || item.getSize() > DEX_BYTES || item.getSize() + totalDex > 512L*1024*1024 || (item.getSize() > 1048576 && item.getCompressedSize() > 0 && item.getSize()/item.getCompressedSize() > 200)) { incomplete("DEX成员读取或压缩比超过预算：" + item.getName()); continue; }
        try (InputStream stream = archive.getInputStream(item)) {
          byte[] bytes = stream.readNBytes(DEX_BYTES+1);
          if (bytes.length != item.getSize()) throw new IllegalArgumentException("DEX声明大小与实际读取不一致");
          inspectDex(bytes,input,inputHash,item.getName(),zipIndex);
        } catch (Exception error) { incomplete(item.getName()+": "+error.getMessage()); }
      }
      if (found == 0 && warnings.size() < 100) warnings.add("所选APK没有根目录DEX，可能为资源配置split");
    }
  }
  static void resolveReferenceTargets(boolean scanIncomplete) {
    Map<String,List<String>> symbols = new HashMap<>();
    for(Object item:targetMethods){Map<?,?> row=(Map<?,?>)item;symbols.computeIfAbsent(row.get("methodId").toString(),ignored->new ArrayList<>()).add(row.get("definitionId").toString());}
    List<String> classIds=targetClasses.stream().map(item->((Map<?,?>)item).get("definitionId").toString()).toList();
    for(Object item:references){
      Map<?,?> row=(Map<?,?>)item; Map<String,Object> target=(Map<String,Object>)row.get("target");
      List<String> matches=target.containsKey("methodId")?symbols.getOrDefault(target.get("methodId").toString(),List.of()):classIds;
      if(target.containsKey("fieldName")){
        // long: 这里只枚举类和方法定义；字段owner的唯一类不能充当字段完整签名已解析的证据。
        target.put("ownerClassDefinitionCandidates",classIds.stream().limit(32).toList());
        target.put("definitionResolution",Map.of("status","not-evaluated","domain","field-definitions"));
        target.put("ownerClassResolution",Map.of("status",scanIncomplete?"unknown":classIds.size()>1?"ambiguous":classIds.size()==1?"unique-declaration":"external-or-unresolved","matches",classIds.size()));
        if(classIds.size()>32){target.put("ownerClassCandidatesTruncated",true);incomplete("字段owner类定义候选超过32项");}
        continue;
      }
      target.put("definitionCandidates",matches.stream().limit(32).toList());
      target.put("definitionResolution",Map.of("status",scanIncomplete?"unknown":matches.size()>1?"ambiguous":matches.size()==1?"unique-declaration":"external-or-unresolved","matches",matches.size(),"association","symbolic-reference-not-runtime-dispatch"));
      if(matches.size()>32){target.put("candidatesTruncated",true);incomplete("单符号定义候选超过32项");}
    }
  }
  static boolean sameDex(Map<?,?> left, Map<?,?> right) {
    return List.of("inputSha256","source","dexEntry","zipIndex","dexSha256").stream().allMatch(key->Objects.equals(left.get(key),right.get(key)));
  }
  static void source(JsonObject config, Path output) {
    if (!config.has("includeSource") || !config.get("includeSource").getAsBoolean() || partial || !(action.equals("class") || action.equals("method"))) return;
    if(action.equals("class")?classes.size()!=1:methods.size()!=1)return;
    try {
      Map<?,?> selected=(Map<?,?>)(action.equals("class")?classes.get(0):methods.get(0)), origin=(Map<?,?>)selected.get("identity");
      if(targetClasses.stream().filter(item->sameDex((Map<?,?>)((Map<?,?>)item).get("identity"),origin)).count()!=1)throw new IllegalArgumentException("所选DEX内同名类定义不唯一");
      JsonObject input=null;
      for(JsonElement item:config.getAsJsonArray("inputs")){JsonObject candidate=item.getAsJsonObject();if(text(candidate,"sha256").equals(origin.get("inputSha256"))&&text(candidate,"source").equals(origin.get("source"))){if(input!=null)throw new IllegalArgumentException("源码输入身份不唯一");input=candidate;}}
      if(input==null)throw new IllegalArgumentException("源码输入身份丢失");
      Path file=Path.of(text(input,"path"));byte[] dexBytes;
      if(!fileHash(file).equals(origin.get("inputSha256")))throw new IllegalArgumentException("源码输入SHA改变");
      if(text(input,"kind").equals("dex"))dexBytes=Files.readAllBytes(file);
      else try(ZipFile zip=new ZipFile(file.toFile());InputStream stream=zip.getInputStream(zip.getEntry(origin.get("dexEntry").toString()))){dexBytes=stream.readNBytes(DEX_BYTES+1);}
      if(!hash(dexBytes).equals(origin.get("dexSha256")))throw new IllegalArgumentException("源码DEX SHA不符");
      // long: JADX只接收选中定义所属的原始DEX，避免跨split去重后的源码冒充definitionId对应的实现。
      Path sourceDex=output.getParent().resolve("source-input.dex");Files.write(sourceDex,dexBytes);
      JadxArgs options = new JadxArgs(); options.setInputFile(sourceDex.toFile()); options.setSkipResources(true); options.setThreadsCount(2); options.setOutDir(output.getParent().toFile());
      try (JadxDecompiler jadx = new JadxDecompiler(options)) {
        jadx.load(); List<JavaClass> matching = jadx.getClassesWithInners().stream().filter(cls -> cls.getClassNode().getRawName().equals(owner)).toList();
        if (matching.size()!=1) throw new IllegalArgumentException("JADX类选择不唯一");
        if (action.equals("method")) {
          String shortId = selected.get("methodName").toString() + selected.get("descriptor").toString();
          if (matching.get(0).getClassNode().getMethods().stream().filter(method -> method.getMethodInfo().getShortId().equals(shortId)).count()!=1) throw new IllegalArgumentException("JADX方法原始签名未唯一匹配");
        }
        String body = matching.get(0).getCode();
        if (body.getBytes(StandardCharsets.UTF_8).length > 2*1024*1024) throw new IllegalArgumentException("类源码超过2MiB");
        Files.writeString(output.getParent().resolve("class-source.java"),body);
        sourceIdentity=new LinkedHashMap<>();sourceIdentity.putAll((Map<String,Object>)origin);sourceIdentity.put("definitionId",selected.get("definitionId"));sourceIdentity.put("association","selected-raw-dex-source-display");
      }
    } catch (Exception error) { incomplete("JADX源码展示失败：" + error.getMessage()); }
  }
  static String boundedReport(Map<String,Object> report) {
    Map<String,Object> header=new LinkedHashMap<>(report);
    for(String field:List.of("classes","methods","references","targetDefinitions"))if(header.containsKey(field))header.put(field,List.of());
    long used=JSON.toJson(header).getBytes(StandardCharsets.UTF_8).length;
    Map<String,Integer> omitted=new LinkedHashMap<>();
    for(String field:List.of("classes","methods","references","targetDefinitions")){
      if(!report.containsKey(field))continue;
      List<?> rows=(List<?>)report.get(field);List<Object> retainedRows=new ArrayList<>();
      for(Object row:rows){long bytes=JSON.toJson(row).getBytes(StandardCharsets.UTF_8).length+1;if(used+bytes>OUTPUT_BYTES-16384)break;used+=bytes;retainedRows.add(row);}
      report.put(field,retainedRows);if(retainedRows.size()!=rows.size())omitted.put(field,rows.size()-retainedRows.size());
    }
    // long: 引用补充定义候选后仍受同一报告预算约束；省略的声明或引用不能继续支持完整性和唯一选择结论。
    if(!omitted.isEmpty()){
      report.put("partial",true);report.put("rawCoverageIncomplete",true);report.put("resultTruncation",omitted);
      Map<String,Object> resolution=new LinkedHashMap<>((Map<String,Object>)report.get("resolution"));resolution.put("status","unknown");resolution.put("reason","report-budget");report.put("resolution",resolution);
      report.remove("sourceArtifact");report.remove("sourceIdentity");
    }
    String json=JSON.toJson(report);if(json.getBytes(StandardCharsets.UTF_8).length>OUTPUT_BYTES)throw new IllegalArgumentException("DEX报告头部超过16MiB");return json;
  }
  public static void main(String[] args) throws Exception {
    JsonObject config = JsonParser.parseString(Files.readString(Path.of(args[0]))).getAsJsonObject();
    output=Path.of(args[1]);
    partial=config.has("inputIncomplete")&&config.get("inputIncomplete").getAsBoolean();
    queryPrefix=config.has("queryPrefix")&&config.get("queryPrefix").getAsBoolean();indexMethods=config.has("indexMethods")&&config.get("indexMethods").getAsBoolean();exportDex=config.has("exportDex")&&config.get("exportDex").getAsBoolean();
    action=text(config,"action"); query=text(config,"query"); owner=text(config,"className"); methodName=text(config,"methodName"); descriptor=text(config,"descriptor"); definitionId=text(config,"definitionId");
    extraClasses=new HashSet<>(); if(config.has("extraClasses")) for(JsonElement name:config.getAsJsonArray("extraClasses")) extraClasses.add(name.getAsString());
    for(JsonElement input:config.getAsJsonArray("inputs")) inspectInput(input.getAsJsonObject());
    boolean scanIncomplete=partial;
    if(action.equals("references"))resolveReferenceTargets(scanIncomplete);
    source(config,output);
    Map<String,Object> report=new LinkedHashMap<>(); report.put("kind","raw-dex-query"); report.put("action",action); report.put("classes",classes); report.put("methods",methods); report.put("references",references);
    report.put("partial",partial); report.put("warnings",warnings); report.put("visitedClasses",visitedClasses); report.put("visitedMethods",visitedMethods); report.put("instructions",instructions);
    report.put("dexes",dexes);report.put("rawCoverageIncomplete",scanIncomplete);
    if(action.equals("references")){List<Object> definitions=new ArrayList<>(targetClasses);definitions.addAll(targetMethods);report.put("targetDefinitions",definitions);}
    int matches=action.equals("classes")||action.equals("class")||(action.equals("references")&&methodName.isEmpty())?classes.size():methods.size();
    report.put("resolution",Map.of("status",scanIncomplete?"unknown":matches==1?"unique":matches==0?"not-found":"ambiguous","matches",matches,"domain","selected-raw-dex-definitions"));
    report.put("selection",Map.of("className",owner,"methodName",methodName,"descriptor",descriptor,"definitionId",definitionId));
    if(Files.exists(output.getParent().resolve("class-source.java"))){report.put("sourceArtifact","class-source.java");report.put("sourceIdentity",sourceIdentity);}
    report.put("coverage","原始DEX声明与静态指令引用；反射、JNI、动态加载与运行时dispatch不由静态引用证明");
    Files.writeString(output,boundedReport(report));
  }
}

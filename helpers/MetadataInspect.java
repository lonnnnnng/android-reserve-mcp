import java.io.File;
import java.nio.file.*;
import java.util.*;
import com.google.gson.Gson;
import jadx.api.*;
import jadx.core.dex.nodes.*;
import jadx.api.plugins.input.data.annotations.*;
import jadx.api.plugins.input.data.attributes.types.AnnotationsAttr;
import kotlin.metadata.*;
import kotlin.metadata.jvm.*;

/** long: 读取未反编译的DEX注解并保留JVM签名，避免JADX重命名或输出省略注解导致错误关联。 */
public class MetadataInspect {
  static Object unwrap(EncodedValue value) {
    Object raw = value.getValue();
    if (raw instanceof List<?> list) return list.stream().map(v -> unwrap((EncodedValue)v)).toList();
    return raw;
  }
  static int integer(Map<String,Object> map, String key, int fallback) { return map.get(key) instanceof Number n ? n.intValue() : fallback; }
  static int[] ints(Object value) { return value instanceof List<?> list ? list.stream().mapToInt(v -> ((Number)v).intValue()).toArray() : new int[0]; }
  static String[] strings(Object value) { return value instanceof List<?> list ? list.stream().map(String::valueOf).toArray(String[]::new) : new String[0]; }
  static String string(Map<String,Object> map, String key) { return map.get(key) instanceof String s ? s : ""; }
  static Map<String,Object> function(KmFunction f, Set<String> methods) {
    Map<String,Object> row = new LinkedHashMap<>();
    var signature = JvmExtensionsKt.getSignature(f);
    row.put("name", f.getName()); row.put("suspend", Attributes.isSuspend(f)); row.put("inline", Attributes.isInline(f));
    row.put("jvmSignature", signature == null ? null : signature.toString());
    row.put("exactDexMatch", signature != null && methods.contains(signature.getName()+signature.getDescriptor()));
    row.put("parameters", f.getValueParameters().stream().map(p -> Map.of("name",p.getName(),"type",String.valueOf(p.getType().getClassifier()))).toList());
    row.put("returnClassifier", String.valueOf(f.getReturnType().getClassifier())); return row;
  }
  public static void main(String[] args) throws Exception {
    List<Object> classes = new ArrayList<>(); boolean partial = false; int examined = 0, metadataBytes = 0;
    JadxArgs options = new JadxArgs(); options.setInputFile(new File(args[0])); options.setSkipResources(true); options.setThreadsCount(2);
    options.setOutDir(new File(args[1]).getParentFile());
    try (JadxDecompiler jadx = new JadxDecompiler(options)) {
      jadx.load();
      for (JavaClass api : jadx.getClassesWithInners()) {
        if (++examined > 5000) { partial = true; break; }
        ClassNode cls = api.getClassNode();
        if (args.length > 2 && !cls.getRawName().startsWith(args[2])) continue;
        if (cls.getClsData() == null) continue;
        Map<String,Object> annotations = new LinkedHashMap<>();
        for (var attribute : cls.getClsData().getAttributes()) if (attribute instanceof AnnotationsAttr attr) for (IAnnotation annotation : attr.getList()) {
          String name = annotation.getAnnotationClass();
          if (!name.contains("kotlin/Metadata") && !name.contains("kotlin.Metadata") && !name.contains("DebugMetadata")) continue;
          Map<String,Object> values = new LinkedHashMap<>(); annotation.getValues().forEach((k,v) -> values.put(k,unwrap(v)));
          annotations.put(name,values);
        }
        Set<String> methods = new LinkedHashSet<>();
        List<String> compose = new ArrayList<>(), bridges = new ArrayList<>(); boolean stateMachine = false;
        for (MethodNode method : cls.getMethods()) {
          String signature = method.getMethodInfo().getShortId(); methods.add(signature);
          if (signature.contains("Landroidx/compose/runtime/Composer;")) compose.add(signature);
          if (method.getName().equals("invokeSuspend")) stateMachine = true;
          // long: 只按DEX中的真实JavascriptInterface注解列出桥接声明，方法名相似不能证明它向JS开放。
          if (method.getAnnotation("android.webkit.JavascriptInterface") != null || method.getAnnotation("Landroid/webkit/JavascriptInterface;") != null) bridges.add(signature);
        }
        if (annotations.isEmpty() && compose.isEmpty() && !stateMachine && bridges.isEmpty()) continue;
        Map<String,Object> row = new LinkedHashMap<>(); row.put("className",cls.getRawName()); row.put("annotations",annotations);
        row.put("dexSignatures",methods); row.put("composeCandidates",compose); row.put("coroutineStateMachineCandidate",stateMachine);
        row.put("javascriptInterfaces",bridges);
        row.put("superClass",String.valueOf(cls.getSuperClass()));
        for (var entry : annotations.entrySet()) if (entry.getKey().contains("Metadata") && !entry.getKey().contains("DebugMetadata")) {
          var raw = (Map<String,Object>) entry.getValue(); int bytes = new Gson().toJson(raw).length()*3;
          metadataBytes += bytes;
          if (bytes > 1024*1024 || metadataBytes > 8*1024*1024) { partial = true; row.put("metadataStatus","budget-exceeded"); row.remove("annotations"); break; }
          try {
            var annotation = JvmMetadataUtil.Metadata(integer(raw,"k",1),ints(raw.get("mv")),strings(raw.get("d1")),strings(raw.get("d2")),string(raw,"xs"),string(raw,"pn"),integer(raw,"xi",0));
            KotlinClassMetadata parsed = KotlinClassMetadata.readLenient(annotation);
            List<KmFunction> functions = List.of(); List<KmProperty> properties = List.of();
            if (parsed instanceof KotlinClassMetadata.Class c) { functions=c.getKmClass().getFunctions(); properties=c.getKmClass().getProperties(); }
            else if (parsed instanceof KotlinClassMetadata.FileFacade c) { functions=c.getKmPackage().getFunctions(); properties=c.getKmPackage().getProperties(); }
            else if (parsed instanceof KotlinClassMetadata.MultiFileClassPart c) { functions=c.getKmPackage().getFunctions(); properties=c.getKmPackage().getProperties(); }
            else if (parsed instanceof KotlinClassMetadata.SyntheticClass c && c.getKmLambda()!=null) functions=List.of(c.getKmLambda().getFunction());
            row.put("metadataStatus","decoded-lenient"); row.put("metadataKind",parsed.getClass().getSimpleName());
            row.put("functions",functions.stream().limit(1000).map(f -> function(f,methods)).toList());
            row.put("properties",properties.stream().limit(1000).map(p -> Map.of("name",p.getName(),"mutable",Attributes.isVar(p))).toList());
            if (functions.size()>1000 || properties.size()>1000) partial = true;
          } catch (Exception error) { row.put("metadataStatus","unsupported-or-malformed"); row.put("metadataError",String.valueOf(error.getMessage())); partial=true; }
        }
        classes.add(row);
      }
    }
    Map<String,Object> report = new LinkedHashMap<>(); report.put("classes",classes); report.put("examined",examined); report.put("partial",partial);
    report.put("limitation","metadata声明和编译结构候选，不恢复完整Compose UI/异步调用链/KMP commonMain");
    Files.writeString(Path.of(args[1]),new Gson().toJson(report));
  }
}
